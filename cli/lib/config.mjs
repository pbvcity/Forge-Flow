import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const builtInExecutors = {
  claude: { cmd: 'claude -p --permission-mode acceptEdits --allowedTools Read,Edit,Write,Bash', profile: 'claude' },
  codex: { cmd: 'codex exec --sandbox workspace-write -c approval_policy=never -c sandbox_workspace_write.network_access=true', profile: 'gpt' },
};

export function configDefaults(home = homedir()) {
  return {
    roles: { builder: 'host', reviewer: 'host', second: '' },
    executors: { ...builtInExecutors },
    review: { panel: [] },
    run: { limitWaitMinutes: [5, 15, 30, 60, 60, 60, 60, 60, 60, 60] },
    playbook: join(home, '.ff/my-rules.md'),
    update: { repo: 'https://github.com/pbvcity/Forge-Flow.git', timeoutMs: 180000 },
  };
}

export function readConfig(cwd = process.cwd(), home = homedir(), warn = console.error) {
  const config = configDefaults(home);
  const found = [];
  for (const path of [join(home, '.ff/config.json'), join(cwd, '.ff/config.json')]) {
    let value;
    try { value = JSON.parse(readFileSync(path, 'utf8')); found.push(path); }
    catch (error) { if (error.code !== 'ENOENT') warn(`${path}: ${error.message}; using defaults`); continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { warn(`${path}: expected an object; using defaults`); continue; }
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(config, key)) warn(`${path}: unknown key ${key}`);
      if (['roles', 'executors', 'review', 'run', 'update'].includes(key)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) { warn(`${path}: invalid ${key}; using defaults`); continue; }
        for (const [name, setting] of Object.entries(item)) {
          if (key !== 'executors' && !Object.hasOwn(config[key], name)) warn(`${path}: unknown key ${key}.${name}`);
          if (key === 'executors' && setting && typeof setting === 'object') for (const field of Object.keys(setting)) {
            if (!['cmd', 'profile', 'reviewArgs'].includes(field)) warn(`${path}: unknown key executors.${name}.${field}`);
          }
          config[key][name] = key === 'executors' ? { ...config[key][name], ...setting } : setting;
        }
      } else config[key] = item;
    }
  }
  return { config, found };
}
export function resolveBuilder(config) {
  const role = config.roles.builder;
  if (role === 'host') return { note: 'builder is host: run this card in a clean host sub-agent or configure roles.builder' };
  if (typeof role === 'string' && role.startsWith('pi:')) {
    const match = role.match(/^pi:([^/]+)\/(.+):([^:]+)$/);
    if (match) return { cmd: ['pi', '--print', '--no-session', '--provider', match[1], '--model', match[2], '--thinking', match[3]], profile: /gpt|codex|o[134]-/i.test(match[2]) ? 'gpt' : /claude/i.test(match[2]) ? 'claude' : 'generic' };
  }
  return config.executors[role] ?? { note: `No executor configured for builder ${String(role)}` };
}
