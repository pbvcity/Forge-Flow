import { lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { readConfig } from './config.mjs';
import { jsonFile } from './fsx.mjs';
import { git } from './git.mjs';
import { runIsLive, executorIsLive } from './run.mjs';
import { mergeContext, mergedProof, listWorktrees } from './worktree.mjs';

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
  const cutoff = Date.now() - days * 86400000;
  let count = 0, bytes = 0, branches = 0;
  console.log(apply ? 'Applying cleanup' : 'Cleanup preview (use --apply to delete)');
  for (const group of ['runs', 'reviews', 'councils']) {
    const root = resolve(cwd, '.ff', group);
    try {
      if (realpathSync(root) !== join(realpathSync(cwd), '.ff', group)) throw new Error('cleanup directory resolves outside its expected path');
      const entries = readdirSync(root).flatMap(name => {
        const path = join(root, name);
        try { return [{ path, mtime: lstatSync(path).mtimeMs }]; }
        catch (error) { console.error(`Skipped ${path}: ${error.message}`); return []; }
      }).sort((a, b) => b.mtime - a.mtime || b.path.localeCompare(a.path));
      for (const { path, mtime } of entries.slice(keep)) {
        if (mtime >= cutoff) continue;
        try {
          const size = inspect(root, path);
          if (group === 'runs' && active(path)) { console.log(`Kept ${path}: run in progress`); continue; }
          if (apply) remove(root, path);
          count++; bytes += size;
          console.log(`${apply ? 'Removed' : 'Would remove'} ${path} (${size} bytes)`);
        } catch (error) { console.error(`Skipped ${path}: ${error.message}`); }
      }
    } catch (error) { if (error.code !== 'ENOENT') console.error(`Skipped ${root}: ${error.message}`); }
  }

  const context = await mergeContext(cwd);
  const local = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/ff/']);
  if (local.exitCode !== 0) console.error(`Skipped branches: ${local.stderr || local.error}`);
  else for (const name of local.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const tip = await git(cwd, ['rev-parse', `refs/heads/${name}`]);
    if (tip.exitCode !== 0) { console.error(`Skipped ${name}: ${tip.stderr || tip.error}`); continue; }
    const proof = await mergedProof(cwd, name, tip.stdout.trim(), context);
    if (!proof.merged) { console.log(`Kept ${name}: ${proof.proof}`); continue; }
    if (!apply) { console.log(`Would delete merged branch ${name} (${proof.proof})`); branches++; continue; }
    if ((await listWorktrees(cwd)).some(entry => entry.branch === name)) { console.log(`Kept ${name}: checked out in a worktree`); continue; }
    const result = await git(cwd, ['update-ref', '-d', `refs/heads/${name}`, tip.stdout.trim()]);
    if (result.exitCode === 0) { console.log(`Deleted merged branch ${name} (${proof.proof})`); branches++; }
    else console.error(`Skipped ${name}: ${result.stderr || result.error}`);
  }
  console.log(`${apply ? 'Removed' : 'Would remove'} ${count} entries, ${branches} branches; ${bytes} bytes ${apply ? 'freed' : 'would be freed'}.`);
  return 0;
}
