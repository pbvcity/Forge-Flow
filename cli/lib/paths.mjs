import { existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';

// The form to compare paths in: links resolved and Windows 8.3 short names (such as RUNNER~1) expanded,
// since git reports long names. A path that does not exist is only resolved.
export function realPath(path) {
  try { return realpathSync.native(path); } catch { return resolve(path); }
}
export const samePath = (a, b) => process.platform === 'win32' ? realPath(a).toLowerCase() === realPath(b).toLowerCase() : realPath(a) === realPath(b);

export const planningDir = (cwd, config = {}) => resolve(cwd, config.paths?.planning ?? 'planning');

export function tempDir(cwd, config = {}) {
  const name = config.paths?.temp ?? ['temp', 'temp-ignore', 'tmp'].find(name => existsSync(join(cwd, name))) ?? 'temp';
  return resolve(cwd, name);
}

export function planPath(cwd, config = {}, explicit) {
  if (explicit) return resolve(cwd, explicit);
  const legacy = join(cwd, 'PLAN.md');
  return existsSync(legacy) ? legacy : join(planningDir(cwd, config), 'PLAN.md');
}

export function planningFile(cwd, config, name) {
  const path = join(planningDir(cwd, config), name), legacy = join(cwd, name);
  return existsSync(path) || !existsSync(legacy) ? path : legacy;
}

export function worktreeRoot(cwd, config = {}) {
  if (config.paths?.worktrees) return resolve(cwd, config.paths.worktrees);
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const main = result.status === 0 ? dirname(resolve(cwd, result.stdout.trim())) : resolve(cwd);
  return resolve(main, '..', `${basename(main)}-worktree`);
}
