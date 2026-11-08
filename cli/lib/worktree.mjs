import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readConfig } from './config.mjs';
import { jsonFile } from './fsx.mjs';
import { git } from './git.mjs';
import { isAlive, runProcess } from './proc.mjs';
import { tempDir, worktreeRoot } from './paths.mjs';

const protectedName = /backup|bak|备份/i;
const secretName = /^(?:\.env(?:\..*)?|.*\.(?:pem|key)|credentials.*)$/i;
const inside = (root, path) => {
  const name = relative(root, path);
  return Boolean(name && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name));
};
const failure = result => result.stderr || result.error || `git exited ${result.exitCode}`;
async function checked(cwd, args) {
  const result = await git(cwd, args);
  if (result.exitCode !== 0 || result.outputTruncated) throw new Error(failure(result));
  return result.stdout.trim();
}

export async function mergeContext(cwd) {
  const remotes = (await git(cwd, ['remote'])).stdout.trim().split(/\r?\n/).filter(Boolean);
  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  let base = head.exitCode === 0 ? head.stdout.trim() : '';
  if (!base) for (const ref of [...(remotes.length ? ['refs/remotes/origin/main', 'refs/remotes/origin/master'] : []), 'refs/heads/main', 'refs/heads/master']) {
    if ((await git(cwd, ['show-ref', '--verify', '--quiet', ref])).exitCode === 0) { base = ref; break; }
  }
  return { base, remote: remotes.length > 0 };
}

export async function mergedProof(cwd, branch, tip, context = null) {
  const { base, remote } = context ?? await mergeContext(cwd);
  if (remote && branch) {
    const result = await runProcess('gh', ['pr', 'list', '--state', 'merged', '--head', branch, '--json', 'headRefOid,number'], { cwd, timeoutMs: 10000 });
    try {
      if (result.exitCode !== 0 || result.outputTruncated) throw new Error(result.stderr || result.error || 'command failed');
      const prs = JSON.parse(result.stdout);
      if (!Array.isArray(prs)) throw new Error('invalid PR list');
      const pr = prs.find(pr => pr?.headRefOid === tip);
      if (pr) return { merged: true, proof: `merged PR #${pr.number} (exact head)` };
    } catch (error) { console.error(`Skipped gh merged proof for ${branch}: ${error.message}`); }
  }
  if (base && (await git(cwd, ['merge-base', '--is-ancestor', tip, base])).exitCode === 0) return { merged: true, proof: `ancestor of ${base}` };
  if (!remote && base && (await git(cwd, ['diff', '--quiet', base, tip, '--'])).exitCode === 0) return { merged: true, proof: `identical tree to ${base} (no remote)` };
  return { merged: false, proof: base ? 'unmerged' : 'default branch unknown' };
}

// A worktree on another drive than the archive cannot be renamed into it.
function moveFile(source, target) {
  try { renameSync(source, target); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    copyFileSync(source, target);
    rmSync(source);
  }
}

export async function listWorktrees(cwd) {
  const result = await git(cwd, ['worktree', 'list', '--porcelain', '-z']);
  if (result.exitCode !== 0 || result.outputTruncated) throw new Error(failure(result));
  const entries = [];
  let entry;
  for (const line of result.stdout.split('\0')) {
    if (line.startsWith('worktree ')) { entry = { path: resolve(line.slice(9)), branch: '', head: '' }; entries.push(entry); }
    else if (entry && line.startsWith('HEAD ')) entry.head = line.slice(5);
    else if (entry && line.startsWith('branch refs/heads/')) entry.branch = line.slice(18);
  }
  return entries;
}

export function liveRun(path) {
  if (!existsSync(path)) return false;
  if (lstatSync(path).isSymbolicLink()) throw new Error(`linked run records: ${path}`);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory() && liveRun(file)) return true;
    if (entry.name === 'run.json') {
      const record = jsonFile(file);
      if ([record?.pid, record?.executorPid].some(pid => pid && isAlive(pid) !== false)) return true;
    }
  }
  return false;
}

export function noLinks(path, boundary) {
  for (let current = resolve(path); ; current = dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`linked path: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === boundary || dirname(current) === current) break;
  }
}

export async function archiveIgnored(path, archive, temp, apply, runsArchive) {
  const result = await git(path, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']);
  if (result.exitCode !== 0 || result.outputTruncated) throw new Error(failure(result));
  const kept = [];
  const names = result.stdout.split('\0').filter(Boolean);
  for (const name of names) {
    const runFile = runsArchive && name.replaceAll('\\', '/').startsWith('.ff/runs/');
    const destination = runFile ? runsArchive : archive;
    const source = resolve(path, name), target = resolve(destination, runFile ? name.slice(9) : name);
    try {
      if (!inside(path, source) || !inside(destination, target)) throw new Error('path outside archive or worktree');
      if (protectedName.test(source) || name.split(/[/\\]/).some(part => secretName.test(part))) throw new Error('protected file');
      noLinks(source, path); noLinks(target, runFile ? dirname(runsArchive) : temp);
      if (lstatSync(source).isDirectory()) {
        names.push(...readdirSync(source).map(child => join(name, child)));
        continue;
      }
      if (existsSync(target)) throw new Error('archive destination exists');
      if (inside(path, target)) throw new Error('archive is inside worktree');
      if (apply) { mkdirSync(dirname(target), { recursive: true }); moveFile(source, target); }
      console.log(`${apply ? 'Archived' : 'Would archive'} ${source} -> ${target}`);
    } catch (error) { kept.push(`${name}: ${error.message}`); }
  }
  return kept;
}

export async function wt(args = [], cwd = process.cwd()) {
  const [command, ...options] = args;
  if (!['new', 'list', 'clean'].includes(command)) throw new Error('usage: ff wt new <slug> [--from <ref>] | list | clean [--apply]');
  cwd = realpathSync(await checked(cwd, ['rev-parse', '--show-toplevel']));
  const { config } = readConfig(cwd);
  const root = worktreeRoot(cwd, config);
  if (command === 'new') {
    const [slug, flag, from, ...extra] = options;
    if (!slug || (flag && (flag !== '--from' || !from)) || extra.length) throw new Error('usage: ff wt new <slug> [--from <ref>]');
    const path = resolve(root, slug);
    if (!inside(root, path)) throw new Error('slug must stay inside the worktree root');
    if (existsSync(path)) throw new Error(`Worktree path exists: ${path}`);
    if ((await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${slug}`])).exitCode === 0) throw new Error(`Branch exists: ${slug}`);
    const context = await mergeContext(cwd);
    if (context.remote) {
      await checked(cwd, ['fetch', '--all']);
      const origin = await git(cwd, ['remote', 'get-url', 'origin']);
      if (origin.exitCode === 0) await checked(cwd, ['remote', 'set-head', 'origin', '--auto']);
    }
    const base = from || (await mergeContext(cwd)).base;
    if (!base) throw new Error('default branch unknown; use --from');
    await checked(cwd, ['worktree', 'add', '-b', slug, '--', path, base]);
    console.log(path);
    return 0;
  }
  if (options.length && !(command === 'clean' && options.length === 1 && options[0] === '--apply')) throw new Error(`Unknown wt ${command} option: ${options.join(' ')}`);
  const apply = options.includes('--apply');
  const entries = await listWorktrees(cwd), context = await mergeContext(cwd);
  const current = realpathSync(await checked(cwd, ['rev-parse', '--show-toplevel']));
  for (const entry of entries) {
    const { path, branch, head } = entry;
    const managed = inside(root, path);
    try {
      if (command === 'clean') {
        if (!managed) { console.log(`Kept ${path}: outside worktree root`); continue; }
        if (path === entries[0].path || realpathSync(path) === current) { console.log(`Kept ${path}: main or current worktree`); continue; }
        if (protectedName.test(path)) throw new Error('backup name');
        noLinks(path, root);
        if (!inside(realpathSync(root), realpathSync(path))) throw new Error('path resolves outside worktree root');
        if (!branch) throw new Error('detached HEAD');
      }
      const status = await checked(path, ['status', '--porcelain', '--untracked-files=all']);
      const proof = await mergedProof(cwd, branch, head, context);
      if (command === 'list') {
        console.log(`${managed ? '*' : '-'} ${path}  ${branch || '(detached)'}  ${head}  ${status ? 'dirty' : 'clean'}  ${proof.merged ? 'merged: ' : ''}${proof.proof}`);
        continue;
      }
      if (status) throw new Error('dirty (tracked changes or untracked files)');
      if (liveRun(join(path, '.ff/runs'))) throw new Error('run process alive');
      if (!proof.merged) throw new Error(proof.proof);
      const temp = tempDir(cwd, config), archive = join(temp, 'worktree-archive', relative(root, path));
      const kept = await archiveIgnored(path, archive, temp, apply);
      if (kept.length) throw new Error(kept.join('; '));
      if (apply) {
        // Recheck after PR lookup and archiving, before any deletion.
        if (await checked(path, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('worktree became dirty');
        if (liveRun(join(path, '.ff/runs')) || liveRun(join(archive, '.ff/runs'))) throw new Error('run process alive');
        if (await checked(path, ['symbolic-ref', '--short', 'HEAD']) !== branch) throw new Error('checked-out branch changed');
        if (await checked(path, ['rev-parse', 'HEAD']) !== head || await checked(cwd, ['rev-parse', `refs/heads/${branch}`]) !== head) throw new Error('branch tip changed');
        await checked(cwd, ['worktree', 'remove', '--', path]);
        console.log(`Removed ${path} (${proof.proof})`);
        const deleted = await git(cwd, ['update-ref', '-d', `refs/heads/${branch}`, head]);
        if (deleted.exitCode !== 0) console.error(`Kept branch ${branch}: ${failure(deleted)}`);
        const pruned = await git(cwd, ['worktree', 'prune']);
        if (pruned.exitCode !== 0) console.error(`Worktree prune failed: ${failure(pruned)}`);
        continue;
      }
      console.log(`Would remove ${path} (${proof.proof})`);
    } catch (error) { console.log(`Kept ${path}: ${error.message}`); }
  }
  return 0;
}
