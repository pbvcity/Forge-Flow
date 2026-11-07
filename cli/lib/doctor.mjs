import { runProcess } from './proc.mjs';
import { readConfig, resolveBuilder } from './config.mjs';
import { invocation } from './run.mjs';
import { updateStatus } from './update.mjs';
import { notifyChannels, notifySettings } from './notify.mjs';
import { protectionState } from './protect.mjs';

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
export async function doctor(cwd = process.cwd()) {
  console.log(`Node ${process.version} (${Number(process.versions.node.split('.')[0]) >= 22 ? 'supported' : 'unsupported; Node 22+ required'})`);
  const families = new Set();
  const names = ['git', 'claude', 'codex', 'pi', 'opencode', 'grok'];
  const results = await Promise.all(names.map(name => runProcess(name, ['--version'], { cwd, timeoutMs: 15000 })));
  for (let i = 0; i < names.length; i++) {
    const result = results[i], name = names[i];
    console.log(`${name}: ${result.timedOut ? 'timed out' : result.exitCode === 0 ? result.stdout.trim() || result.stderr.trim() || 'available (no version output)' : 'unavailable'}`);
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
  const { config, found } = readConfig(cwd);
  console.log(`Config: ${found.length ? found.join(', ') : 'not found (defaults)'}`);
  console.log(`Model families: ${families.size} (inferred from CLI/model names; availability is not authentication)`);
  await updateStatus(cwd, config);
  console.log(`Notifications: ${notifyChannels(notifySettings()).join(', ') || 'off'}`);
  console.log(`Branch protection: ${await protectionState(cwd)}`);
  const builder = resolveBuilder(config);
  console.log(`Fallback: ${config.roles.fallback || 'none'}${config.roles.fallback && !resolveBuilder(config, config.roles.fallback).cmd ? ' (unavailable)' : ''}`);
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
