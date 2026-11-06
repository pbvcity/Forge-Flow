import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runProcess } from './proc.mjs';
import { git } from './git.mjs';
import { readConfig } from './config.mjs';
import { latestRun, runIsLive } from './run.mjs';

const hosts = [
  { name: 'claude', list: ['plugin', 'list'], installed: /\bff@forge-flow\b/, commands: [['plugin', 'marketplace', 'update', 'forge-flow'], ['plugin', 'update', 'ff@forge-flow']], reload: '/reload-plugins or a new session' },
  { name: 'codex', list: ['plugin', 'list', '--json'], installed: /\bff@forge-flow\b/, commands: [['plugin', 'marketplace', 'upgrade'], ['plugin', 'add', 'ff@forge-flow', '--json']], reload: 'restart Codex' },
  { name: 'pi', list: ['list'], installed: /forge-flow/i, commands: [['update', '--extensions']], reload: '/reload or a new session' },
];

const installedVersion = () => JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version;

export async function latestTag(cwd, config) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const result = await git(cwd, ['-c', 'versionsort.suffix=-', 'ls-remote', '--tags', '--refs', '--sort=-v:refname', '--', config.update.repo], { timeoutMs: 15000, env });
  if (result.exitCode !== 0 || result.error || result.timedOut) return { note: `repository unavailable: ${result.error ?? result.reason ?? result.stderr.trim()}` };
  const tag = result.stdout.match(/refs\/tags\/(\S+)/)?.[1];
  return tag ? { tag } : { note: 'repository has no version tags' };
}

export async function updateStatus(cwd, config) {
  const latest = await latestTag(cwd, config);
  console.log(`update: this copy is ${installedVersion()}; ${latest.tag ? `latest tag ${latest.tag}` : latest.note}`);
}

async function updateHost(host, cwd, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (const command of host.commands) {
    const result = await runProcess(host.name, command, { cwd, timeoutMs: Math.max(1, deadline - Date.now()) });
    if (result.exitCode !== 0 || result.timedOut || result.error) {
      console.log(`${host.name}: failed at "${host.name} ${command.join(' ')}": ${result.error ?? result.reason ?? (result.stderr.trim() || `exit ${result.exitCode}`)}`);
      return false;
    }
    if (result.stdout.trim()) console.log(result.stdout.trim());
  }
  console.log(`${host.name}: updated; reload with ${host.reload}`);
  return true;
}

// Each host has its own updater. One failing never stops the others.
export async function update(args = [], cwd = process.cwd()) {
  if (args.some(arg => arg !== '--check')) throw new Error('usage: ff update [--check]');
  const check = args.includes('--check');
  const { config } = readConfig(cwd);
  if (runIsLive(latestRun(cwd))) console.log('Reminder: ff run is active; reload Forge Flow after it finishes.');
  if (check) await updateStatus(cwd, config);
  let failures = 0;
  for (const host of hosts) {
    const list = await runProcess(host.name, host.list, { cwd, timeoutMs: 15000 });
    if (list.exitCode !== 0 || list.error || list.timedOut) { console.log(`${host.name}: not available; skipped`); continue; }
    if (!host.installed.test(list.stdout)) { console.log(`${host.name}: Forge Flow not installed; skipped`); continue; }
    if (check) { console.log(`${host.name}: installed; ff update refreshes it`); continue; }
    if (!await updateHost(host, cwd, config.update.timeoutMs)) failures++;
  }
  return failures ? 1 : 0;
}
