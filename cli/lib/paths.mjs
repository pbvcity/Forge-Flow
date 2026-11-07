import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';

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
