import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { readConfig } from './config.mjs';
import { jsonFile } from './fsx.mjs';
import { git } from './git.mjs';
import { realPath, samePath, tempDir, worktreeRoot } from './paths.mjs';
import { runIsLive, executorIsLive } from './run.mjs';
import { mergeContext, mergedProof, listWorktrees } from './worktree.mjs';

// Temporary value: failed branches and temp entries untouched this long are listed as stale, never deleted.
export const STALE_DAYS = 30;

const protectedName = /backup|bak|备份/i;
function inside(root, path) {
  const name = relative(root, path);
  return name && name !== '..' && !name.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(name);
}

function inspect(root, path) {
  if (!inside(root, realpathSync(path))) throw new Error('path resolves outside cleanup directory');
  if (protectedName.test(basename(path))) throw new Error('backup name');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('linked path');
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((bytes, name) => bytes + inspect(root, join(path, name)), 0);
}

function active(path) {
  const run = jsonFile(join(path, 'run.json'));
  return runIsLive(run) || executorIsLive(run);
}

function remove(root, path) {
  inspect(root, path);
  if (!lstatSync(path).isDirectory()) return unlinkSync(path);
  for (const name of readdirSync(path)) remove(root, join(path, name));
  rmdirSync(path);
}

// Entries beyond the retention count that are also older than the cutoff, per state directory.
function staleRecords(cwd, keep, days, warn = console.error) {
  const cutoff = Date.now() - days * 86400000, stale = [];
  for (const group of ['runs', 'reviews', 'councils']) {
    const root = resolve(cwd, '.ff', group);
    try {
      if (realpathSync(root) !== join(realpathSync(cwd), '.ff', group)) throw new Error('cleanup directory resolves outside its expected path');
      const entries = readdirSync(root).flatMap(name => {
        const path = join(root, name);
        try { return [{ path, mtime: lstatSync(path).mtimeMs }]; }
        catch (error) { warn(`Skipped ${path}: ${error.message}`); return []; }
      }).sort((a, b) => b.mtime - a.mtime || b.path.localeCompare(a.path));
      for (const { path, mtime } of entries.slice(keep)) if (mtime < cutoff) stale.push({ group, root, path });
    } catch (error) { if (error.code !== 'ENOENT') warn(`Skipped ${root}: ${error.message}`); }
  }
  return stale;
}

async function localBranches(cwd, prefix = '') {
  const result = await git(cwd, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(committerdate:unix)', `refs/heads/${prefix}`]);
  if (result.exitCode !== 0) throw new Error(result.stderr || result.error || 'git failed');
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [ref, tip, committed] = line.split('\t');
    return { name: ref.replace(/^refs\/heads\//, ''), tip, committedMs: Number(committed) * 1000 };
  });
}

const day = ms => new Date(ms).toISOString().slice(0, 10);
const ancestorOf = async (cwd, tip, base) => Boolean(base) && (await git(cwd, ['merge-base', '--is-ancestor', tip, base])).exitCode === 0;

// Local branches whose tips the base already contains, in one git call. Offline: no fetch, no gh.
async function mergedInto(cwd, base, prefix = '') {
  const result = await git(cwd, ['for-each-ref', `--merged=${base}`, '--format=%(refname)', `refs/heads/${prefix}`]);
  if (result.exitCode !== 0 || result.outputTruncated) throw new Error(result.stderr || result.error || 'git failed');
  return new Set(result.stdout.trim().split(/\r?\n/).filter(Boolean).map(ref => ref.replace(/^refs\/heads\//, '')));
}
// Reading status for a hint must not take another worktree's index.lock.
const readStatus = path => git(path, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all']);

// Size and newest change of a tree without following links; a protected name anywhere hides the whole entry.
function measure(path) {
  const stat = lstatSync(path);
  if (protectedName.test(basename(path))) throw new Error('backup name');
  let bytes = stat.isDirectory() ? 0 : stat.size, newest = stat.mtimeMs;
  if (stat.isDirectory() && !stat.isSymbolicLink()) for (const name of readdirSync(path)) {
    const child = measure(join(path, name));
    bytes += child.bytes; newest = Math.max(newest, child.newest);
  }
  return { bytes, newest };
}

// Stale entries under the temp folder: the smallest unit is a second-level folder such as temp/scripts/<task>,
// or a top-level folder with no subfolders. backups/ and backup names are never listed.
export function staleTempEntries(cwd, config, cutoff = Date.now() - STALE_DAYS * 86400000) {
  const temp = tempDir(cwd, config), stale = [];
  if (!existsSync(temp) || lstatSync(temp).isSymbolicLink()) return stale;
  const candidates = [];
  for (const kind of readdirSync(temp)) {
    const path = join(temp, kind);
    try {
      if (kind === 'backups' || protectedName.test(kind) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) continue;
      const children = readdirSync(path).map(name => join(path, name)).filter(child => { try { return lstatSync(child).isDirectory(); } catch { return false; } });
      candidates.push(...(children.length ? children : [path]));
    } catch {}
  }
  for (const path of candidates) {
    try {
      const { bytes, newest } = measure(path);
      if (newest < cutoff) stale.push({ path: relative(cwd, path), bytes, newest });
    } catch {}
  }
  return stale;
}

export async function cleanup(args = [], cwd = process.cwd()) {
  const { config } = readConfig(cwd);
  let { keep, days } = config.cleanup, apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--keep' || args[i] === '--days') {
      const option = args[i], value = args[++i];
      if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${option} needs a non-negative integer`);
      if (option === '--keep') keep = Number(value); else days = Number(value);
    } else throw new Error(`Unknown cleanup option: ${args[i]}`);
  }
  for (const [name, value] of Object.entries({ keep, days })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`cleanup.${name} must be a non-negative integer`);
  }
  let count = 0, bytes = 0, branches = 0, listed = 0;
  console.log(apply ? 'Applying cleanup' : 'Cleanup preview (use --apply to delete)');
  for (const { group, root, path } of staleRecords(cwd, keep, days)) {
    try {
      const size = inspect(root, path);
      if (group === 'runs' && active(path)) { console.log(`Kept ${path}: run in progress`); continue; }
      if (apply) remove(root, path);
      count++; bytes += size;
      console.log(`${apply ? 'Removed' : 'Would remove'} ${path} (${size} bytes)`);
    } catch (error) { console.error(`Skipped ${path}: ${error.message}`); }
  }

  const context = await mergeContext(cwd);
  const merged = new Set();
  const local = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/ff/']);
  if (local.exitCode !== 0) console.error(`Skipped branches: ${local.stderr || local.error}`);
  else for (const name of local.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const tip = await git(cwd, ['rev-parse', `refs/heads/${name}`]);
    if (tip.exitCode !== 0) { console.error(`Skipped ${name}: ${tip.stderr || tip.error}`); continue; }
    const proof = await mergedProof(cwd, name, tip.stdout.trim(), context);
    if (!proof.merged) { console.log(`Kept ${name}: ${proof.proof}`); continue; }
    merged.add(name);
    if (!apply) { console.log(`Would delete merged branch ${name} (${proof.proof})`); branches++; continue; }
    if ((await listWorktrees(cwd)).some(entry => entry.branch === name)) { console.log(`Kept ${name}: checked out in a worktree`); continue; }
    const result = await git(cwd, ['update-ref', '-d', `refs/heads/${name}`, tip.stdout.trim()]);
    if (result.exitCode === 0) { console.log(`Deleted merged branch ${name} (${proof.proof})`); branches++; }
    else console.error(`Skipped ${name}: ${result.stderr || result.error}`);
  }

  // Listed only, never deleted: merged branches outside ff/, stale failed branches, stale temp entries.
  // The hints use local ancestry only, so they never wait on gh.
  const staleCutoff = Date.now() - STALE_DAYS * 86400000;
  if (local.exitCode === 0) {
    try {
      const checkedOut = new Set((await listWorktrees(cwd)).map(entry => entry.branch).filter(Boolean));
      const baseName = context.base.replace(/^refs\/(?:heads|remotes\/[^/]+)\//, '');
      const outside = context.base ? await mergedInto(cwd, context.base) : new Set();
      for (const name of [...outside].sort()) {
        if (name.startsWith('ff/') || name === baseName || checkedOut.has(name)) continue;
        console.log(`Listed only: merged branch outside ff/: ${name} (ancestor of ${context.base}); delete it yourself if it is done`); listed++;
      }
      for (const { name, committedMs } of await localBranches(cwd, 'ff/failed/')) {
        if (merged.has(name) || committedMs >= staleCutoff) continue;
        console.log(`Listed only: failed branch older than ${STALE_DAYS} days: ${name}, last commit ${day(committedMs)}; delete it yourself if it is done`); listed++;
      }
    } catch (error) { console.error(`Skipped branch hints: ${error.message}`); }
  }
  for (const { path, bytes: size, newest } of staleTempEntries(cwd, config, staleCutoff)) {
    console.log(`Listed only: temp entry older than ${STALE_DAYS} days: ${path} (${size} bytes, last change ${day(newest)}); delete it yourself if it is done`); listed++;
  }
  console.log(`${apply ? 'Removed' : 'Would remove'} ${count} entries, ${branches} branches; ${bytes} bytes ${apply ? 'freed' : 'would be freed'}.${listed ? ` ${listed} items listed only, not deleted.` : ''}`);
  return 0;
}

// Offline counts for ff status: local git only, no fetch, no gh. Any failure counts as zero.
export async function cleanupCounts(cwd) {
  const counts = { records: 0, worktrees: 0, branches: 0, failed: 0 };
  const { config } = readConfig(cwd, undefined, () => {});
  try { counts.records = staleRecords(cwd, config.cleanup.keep, config.cleanup.days, () => {}).filter(({ group, path }) => group !== 'runs' || !active(path)).length; } catch {}
  let base = '';
  try { ({ base } = await mergeContext(cwd)); } catch {}
  if (!base) return counts;
  const staleCutoff = Date.now() - STALE_DAYS * 86400000;
  try {
    const merged = await mergedInto(cwd, base, 'ff/');
    for (const { name, committedMs } of await localBranches(cwd, 'ff/')) {
      if (merged.has(name)) counts.branches++;
      else if (name.startsWith('ff/failed/') && committedMs < staleCutoff) counts.failed++;
    }
  } catch {}
  try {
    const top = await git(cwd, ['rev-parse', '--show-toplevel']);
    if (top.exitCode !== 0) throw new Error('not a repository');
    // cwd may carry Windows short names while git lists long ones, so both sides are compared expanded.
    const current = top.stdout.trim(), root = realPath(worktreeRoot(cwd, config));
    const entries = await listWorktrees(cwd);
    for (const { path, head } of entries.slice(1)) {
      if (!existsSync(path) || !inside(root, realPath(path)) || samePath(path, current) || protectedName.test(path)) continue;
      if (!await ancestorOf(cwd, head, base)) continue;
      const status = await readStatus(path);
      if (status.exitCode === 0 && !status.stdout.trim()) counts.worktrees++;
    }
  } catch {}
  return counts;
}

export async function cleanupHint(cwd) {
  const { records, worktrees, branches, failed } = await cleanupCounts(cwd);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [
    worktrees && `${plural(worktrees, 'merged worktree')}`,
    branches && `${plural(branches, 'merged ff/* branch')}`.replace('branchs', 'branches'),
    failed && `${plural(failed, 'failed branch')} older than ${STALE_DAYS} days`.replace('branchs', 'branches'),
    records && `${plural(records, 'old record')} beyond retention`,
  ].filter(Boolean);
  if (!parts.length) return '';
  const commands = [worktrees && 'ff wt clean', (branches || failed || records) && 'ff cleanup'].filter(Boolean);
  return `Cleanup: ${parts.join(', ')}. Run ${commands.join(' and ')} to see them.`;
}
