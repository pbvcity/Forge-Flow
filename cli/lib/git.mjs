import { runProcess } from './proc.mjs';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
const lanePhase = new AsyncLocalStorage();
export const withLaneGit = action => lanePhase.run(true, action);
export function projectGitEnv(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^GIT_(DIR|WORK_TREE|IMPLICIT_WORK_TREE|INDEX_FILE|COMMON_DIR|PREFIX|INTERNAL_SUPER_PREFIX|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|GRAFT_FILE|SHALLOW_FILE|NO_REPLACE_OBJECTS|REPLACE_REF_BASE|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/i.test(key)));
}
export async function git(cwd, args, options = {}) {
  const lane = lanePhase.getStore();
  const invoke = () => runProcess('git', lane ? ['-c', 'gc.auto=0', ...args] : args, { timeoutMs: 10000, ...options, cwd, env: projectGitEnv(options.env) });
  const result = await invoke();
  if (lane && result.exitCode !== 0 && !result.timedOut && /\.lock\b/i.test(`${result.stderr}\n${result.error ?? ''}`)) {
    await new Promise(done => setTimeout(done, 100));
    return invoke();
  }
  return result;
}

export async function excludeGitEntries(cwd, entries) {
  const result = await git(cwd, ['rev-parse', '--git-path', 'info/exclude']);
  if (result.exitCode !== 0) {
    console.error(`Warning: could not locate git info/exclude: ${result.stderr || result.error || 'git unavailable'}; continuing.`);
    return;
  }
  try {
    const path = resolve(cwd, result.stdout.trim());
    let text = '';
    try { text = readFileSync(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lines = text.split(/\r?\n/);
    const missing = entries.filter(entry => !lines.includes(entry));
    if (missing.length) appendFileSync(path, `${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  } catch (error) { console.error(`Warning: cannot update git info/exclude: ${error.message}; continuing.`); }
}

const defaultBranches = ['main', 'master'];

// Unattended work never lands on the main branch: it gets its own run branch.
export async function startRunBranch(cwd, id) {
  const current = (await git(cwd, ['branch', '--show-current'])).stdout.trim();
  const head = (await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).stdout.trim().replace(/^origin\//, '');
  if (current && !defaultBranches.includes(current) && current !== head) return current;
  const name = `ff/run-${id.slice(0, 19)}`;
  return (await git(cwd, ['switch', '-q', '-c', name])).exitCode === 0 ? name : null;
}

// Run branches hold working commits. Hooks and signing belong to the normal flow that closes them.
const commitArgs = ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify'];
const timeoutMs = 600000;
const headOf = async cwd => (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();

export async function commitAll(cwd, message) {
  const added = await git(cwd, ['add', '-A'], { timeoutMs });
  if (added.exitCode !== 0) return { ok: false, error: added.stderr || added.error || 'git add failed' };
  const status = await git(cwd, ['status', '--porcelain'], { timeoutMs });
  if (status.exitCode !== 0) return { ok: false, error: status.stderr || status.error || 'git status failed' };
  if (!status.stdout.trim()) return { ok: true, head: await headOf(cwd) };
  const commit = await git(cwd, [...commitArgs, '-m', message], { timeoutMs });
  if (commit.exitCode !== 0) return { ok: false, error: `${commit.stdout}\n${commit.stderr}\n${commit.error ?? ''}`.trim() };
  return { ok: true, head: await headOf(cwd) };
}

export async function commitPaths(cwd, message, paths) {
  const added = [];
  for (const path of paths) if ((await git(cwd, ['add', '--', path], { timeoutMs })).exitCode === 0) added.push(path);
  const staged = added.length ? await git(cwd, ['diff', '--cached', '--quiet', '--', ...added], { timeoutMs }) : { exitCode: 0 };
  if (staged.exitCode === 0) return { ok: true, head: await headOf(cwd) };
  const commit = await git(cwd, [...commitArgs, '-m', message, '--', ...added], { timeoutMs });
  if (commit.exitCode !== 0) return { ok: false, error: `${commit.stdout}\n${commit.stderr}\n${commit.error ?? ''}`.trim() };
  return { ok: true, head: await headOf(cwd) };
}
