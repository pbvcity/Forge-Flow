import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './proc.mjs';
import { readConfig, resolveBuilder } from './config.mjs';
import { resolveReviewer } from './review.mjs';
import { invocation } from './run.mjs';
import { updateStatus } from './update.mjs';
import { notifyChannels, notifySettings } from './notify.mjs';
import { protectionState } from './protect.mjs';
import { initState } from './init.mjs';
import { agentsStatus, autoSyncAgents } from './agents.mjs';

export function modelFamily(model, vendor) {
  if (/gpt|codex|^o[134](?:-|$)/i.test(model)) return 'openai';
  if (/claude/i.test(model)) return 'anthropic';
  if (/gemini/i.test(model)) return 'google';
  if (/grok/i.test(model)) return 'xai';
  return vendor;
}
export function groupModels(text) {
  const groups = new Map();
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2 || /^(provider|vendor)$/i.test(fields[0]) || !/^[a-z0-9][a-z0-9-]*$/.test(fields[0]) || fields[1].startsWith('/')) continue;
    const [vendor, model] = fields;
    if (!groups.has(vendor)) groups.set(vendor, []);
    groups.get(vendor).push(model);
  }
  return groups;
}
// Sub-agent files that pin a model or effort, read for that one line only.
export function sessionTiers(home = homedir()) {
  const count = (dir, ext, line) => {
    try { return readdirSync(dir).filter(name => name.endsWith(ext) && line.test(readFileSync(join(dir, name), 'utf8'))).length; }
    catch { return 0; }
  };
  const claude = count(join(home, '.claude', 'agents'), '.md', /^(?:model|effort):\s*\S/m);
  const codex = count(join(home, '.codex', 'agents'), '.toml', /^(?:model|model_reasoning_effort)\s*=/m);
  return claude || codex ? `Claude Code ${claude}, Codex ${codex}` : 'none (setup can add three)';
}

export function loginEvidence(name, env = process.env, home = homedir(), platform = process.platform) {
  const variables = name === 'codex' ? ['OPENAI_API_KEY'] : name === 'claude' ? ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] : [];
  for (const variable of variables) if (env[variable]) return `found (${variable})`;
  const file = name === 'codex' ? join(env.CODEX_HOME || join(home, '.codex'), 'auth.json')
    : name === 'claude' ? join(home, '.claude', '.credentials.json') : null;
  if (!file) return 'unknown';
  try {
    if (statSync(file).isFile()) return `found (${file})`;
    return 'unknown';
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) return 'unknown';
  }
  return name === 'claude' && platform === 'darwin' ? 'unknown' : 'not found';
}

export async function doctor(cwd = process.cwd()) {
  console.log(`Node ${process.version} (${Number(process.versions.node.split('.')[0]) >= 22 ? 'supported' : 'unsupported; Node 22+ required'})`);
  const families = new Set();
  const names = ['git', 'claude', 'codex', 'pi', 'opencode', 'grok'];
  const { config, found } = readConfig(cwd);
  autoSyncAgents(config);
  const roleCommands = new Map();
  for (const [role, selected] of Object.entries(config.roles)) {
    if (!selected) continue;
    const reviewing = ['reviewer', 'second', 'consult'].includes(role);
    const executor = reviewing ? resolveReviewer(config, selected, { quiet: true }) : resolveBuilder(config, selected);
    const command = reviewing ? executor.command : executor.cmd ? invocation(executor).command : undefined;
    if (!command) {
      if (reviewing && selected !== 'host') console.log(`${role}: ${executor.note}`);
      continue;
    }
    roleCommands.set(role, command);
    if (!names.includes(command)) names.push(command);
  }
  const results = await Promise.all(names.map(name => runProcess(name, ['--version'], { cwd, timeoutMs: 15000 })));
  for (let i = 0; i < names.length; i++) {
    const result = results[i], name = names[i];
    console.log(`${name}: ${result.timedOut ? 'timed out' : result.exitCode === 0 ? result.stdout.trim() || result.stderr.trim() || 'available (no version output)' : 'unavailable'}`);
    if (name !== 'git' && result.exitCode === 0 && !result.timedOut) console.log(`  login: ${loginEvidence(name)}`);
    if (result.exitCode === 0 && ['claude', 'codex', 'grok'].includes(name)) families.add({ claude: 'anthropic', codex: 'openai', grok: 'xai' }[name]);
  }
  if (results[names.indexOf('pi')].exitCode === 0) {
    const models = await runProcess('pi', ['--list-models'], { cwd, timeoutMs: 30000 });
    if (models.exitCode === 0) for (const [vendor, list] of groupModels(models.stdout)) {
      console.log(`pi ${vendor}: ${list.join(', ')}`);
      for (const model of list) families.add(modelFamily(model, vendor));
    } else console.log(`pi model list ${models.timedOut ? 'timed out' : 'unavailable'}`);
  }
  if (results[names.indexOf('opencode')].exitCode === 0) {
    const models = await runProcess('opencode', ['models'], { cwd, timeoutMs: 30000 });
    if (models.exitCode === 0) {
      const providers = new Map();
      for (const line of models.stdout.split(/\r?\n/)) {
        const match = line.trim().match(/^([^/\s]+)\/(\S+)$/);
        if (!match) continue;
        if (!providers.has(match[1])) providers.set(match[1], []);
        providers.get(match[1]).push(match[2]);
        families.add(modelFamily(match[2], match[1]));
      }
      for (const [provider, list] of providers) console.log(`opencode ${provider}: ${list.join(', ')}`);
    } else console.log(`opencode model list ${models.timedOut ? 'timed out' : 'unavailable'}`);
  }
  console.log(`Config: ${found.length ? found.join(', ') : 'not found (defaults)'}`);
  if (config.projectExecutors.length) console.log(`Project executors: ${config.projectExecutors.join(', ')} (builders use these definitions; review and council ignore them)`);
  const impacts = { builder: 'ff run cannot build', reviewer: 'ff review cannot run the configured reviewer', second: 'ff review cannot run the second reviewer', fallback: 'ff run cannot use the fallback', consult: 'ff run cannot consult on unclear failures' };
  for (const [role, command] of roleCommands) {
    const result = results[names.indexOf(command)];
    if (result.exitCode !== 0 || result.timedOut) console.log(`${role} uses ${command}, which ${result.timedOut ? 'did not respond' : 'is not installed'}: ${impacts[role] || `the ${role} role cannot run`}`);
  }
  const layout = await initState(cwd, config);
  console.log(`Files and folders: ${layout.hasBlock ? 'present' : 'missing'} (${layout.rules})`);
  console.log(`Temp folder: ${layout.temp}/ (${layout.tempIgnored ? 'ignored' : 'not ignored'})`);
  console.log(`Model families: ${families.size} (inferred from CLI/model names; availability is not authentication)`);
  await updateStatus(cwd, config);
  console.log(`Session tiers: ${sessionTiers()}`);
  console.log(`Codex agents: ${agentsStatus()}`);
  console.log(`Notifications: ${notifyChannels(notifySettings()).join(', ') || 'off'}`);
  console.log(`Branch protection: ${await protectionState(cwd)}`);
  const builder = resolveBuilder(config);
  console.log(`Fallback: ${config.roles.fallback || 'none'}${config.roles.fallback && !resolveBuilder(config, config.roles.fallback).cmd ? ' (unavailable)' : ''}`);
  const consult = config.roles.consult;
  const consultCommand = roleCommands.get('consult');
  const consultProbe = consultCommand ? results[names.indexOf(consultCommand)] : undefined;
  console.log(`Consult: ${consult || 'none'}${consult ? (consultProbe && consultProbe.exitCode === 0 && !consultProbe.timedOut ? ' (available)' : ' (unavailable)') : ''}`);
  if (!builder.cmd) console.log(`Unattended runs: no (${builder.note})`);
  else {
    const { command } = invocation(builder);
    const result = results[names.indexOf(command)] ?? await runProcess(command, ['--version'], { cwd, timeoutMs: 15000 });
    const missing = [];
    if (Number(process.versions.node.split('.')[0]) < 22) missing.push('Node 22+ required');
    if (results[0].exitCode !== 0) missing.push('git unavailable');
    if (result.exitCode !== 0 || result.timedOut) missing.push(`${command} ${result.timedOut ? 'timed out' : 'unavailable'}`);
    console.log(`Unattended runs: ${missing.length ? 'no' : 'yes'} (builder: ${config.roles.builder}; ${missing.length ? missing.join('; ') : command})`);
  }
  return Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1;
}
