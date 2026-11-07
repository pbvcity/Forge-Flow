import { lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { readConfig } from './config.mjs';
import { jsonFile } from './fsx.mjs';
import { git } from './git.mjs';
import { runIsLive, executorIsLive } from './run.mjs';

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

  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  let base = head.exitCode === 0 ? head.stdout.trim() : '';
  if (!base) for (const name of ['main', 'master']) {
    if ((await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])).exitCode === 0) { base = `refs/heads/${name}`; break; }
  }
  const local = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/ff/']);
  if (local.exitCode !== 0) console.error(`Skipped branches: ${local.stderr || local.error}`);
  else for (const name of local.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const merged = base && (await git(cwd, ['merge-base', '--is-ancestor', `refs/heads/${name}`, base])).exitCode === 0;
    if (!merged) { console.log(`Kept ${name}: ${base ? 'unmerged' : 'default branch unknown'}`); continue; }
    if (!apply) { console.log(`Would delete merged branch ${name}`); branches++; continue; }
    const result = await git(cwd, ['branch', '-d', '--', name]);
    if (result.exitCode === 0) { console.log(`Deleted merged branch ${name}`); branches++; }
    else console.error(`Skipped ${name}: ${result.stderr || result.error}`);
  }
  console.log(`${apply ? 'Removed' : 'Would remove'} ${count} entries, ${branches} branches; ${bytes} bytes ${apply ? 'freed' : 'would be freed'}.`);
  return 0;
}
