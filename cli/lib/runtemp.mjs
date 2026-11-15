import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { jsonFile, retryIO } from './fsx.mjs';
import { excludeGitEntries, git } from './git.mjs';
import { isAlive } from './proc.mjs';
import { realPath, samePath, tempDir } from './paths.mjs';
import { executorIsLive, runIsLive } from './run.mjs';

// Processes that ff run starts get TEMP, TMP and TMPDIR pointed at <temp>/tmp/<run id> in the project, so what they
// leave behind is removed with the run instead of piling up in the system temp folder. The caller's shell is never touched.
export const runTempRoot = (cwd, config) => join(tempDir(cwd, config), 'tmp');
export const tempKeys = ['TEMP', 'TMP', 'TMPDIR'];
const OWNER = '.ff-run.json';
const protectedName = /backup|bak|备份/i;
const DAY = 86400000;
// Unix socket paths stop at 104 bytes on macOS (108 on Linux); leave room for the socket's own name.
const SOCKET_PATH_LIMIT = 104, SOCKET_NAME_ROOM = 40;
const socketSafe = path => process.platform === 'win32' || Buffer.byteLength(path) + SOCKET_NAME_ROOM <= SOCKET_PATH_LIMIT;

// The short link a deep project's run gets in the system temp folder. Only an ff-named link that still points at
// the folder it was recorded for is removed, and only the link itself.
function removeLink(link, dir) {
  try {
    if (typeof link !== 'string' || !basename(link).startsWith('ff-') || !lstatSync(link).isSymbolicLink()) return;
    if (!samePath(resolve(dirname(link), readlinkSync(link)), dir)) return;
    unlinkSync(link);
  } catch {}
}

// A unique ff-<name> link in `base` pointing at `dir`, or null when none can be made.
function shortLink(dir, base, name) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const link = join(base, `ff-${name}${attempt ? `-${attempt}` : ''}`);
    try { symlinkSync(dir, link, 'dir'); return link; }
    catch (error) {
      if (error.code !== 'EEXIST') return null;
      try { if (lstatSync(link).isSymbolicLink() && samePath(resolve(base, readlinkSync(link)), dir)) return link; } catch {}
    }
  }
  return null;
}

// The temp folder from before any run redirected it, carried to children in FF_SYSTEM_TEMP. ff's own private files,
// such as reviewer settings that can hold credentials, go here: the project folder may be synced.
export const systemTemp = (env = process.env) => env.FF_SYSTEM_TEMP || tmpdir();

function inside(root, path) {
  const name = relative(root, path);
  return Boolean(name) && name !== '..' && !name.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(name);
}

// Folders directly under <temp>/tmp. A linked root, linked entries, entries resolving elsewhere, and backup names are never returned.
function entries(root) {
  let names;
  try {
    if (lstatSync(root).isSymbolicLink()) return [];
    names = readdirSync(root);
  } catch { return []; }
  const real = realpathSync.native(root);
  return names.flatMap(name => {
    const path = join(root, name);
    try {
      const stat = lstatSync(path);
      if (protectedName.test(name) || stat.isSymbolicLink() || !stat.isDirectory() || !inside(real, realpathSync.native(path))) return [];
      return [path];
    } catch { return []; }
  });
}

// Whether the run that made a temp folder is live, judged like ff status judges a run: true, false, or 'unknown'.
// PIDs mean nothing on another machine, so a folder made elsewhere (a synced project) is never confirmed over here.
export function tempLive(path) {
  const owner = jsonFile(join(path, OWNER));
  if (!owner || typeof owner.cwd !== 'string' || typeof owner.id !== 'string') return 'unknown';
  if (owner.host && owner.host !== hostname()) return 'unknown';
  const run = jsonFile(join(owner.cwd, '.ff/runs', owner.id, 'run.json'));
  if (run) return runIsLive(run) || executorIsLive(run);
  return isAlive(owner.pid);
}

// Never follows a link. Links, backup names, and on Windows read-only hard links (unlinking one can clear the
// attribute on its other names) stay where they are and are reported in `left`.
function removeTree(path, left) {
  try {
    if (protectedName.test(basename(path))) throw Object.assign(new Error('backup name'), { code: 'backup name' });
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Object.assign(new Error('linked path'), { code: 'linked path' });
    if (stat.isDirectory()) {
      if (!emptyDir(path, left)) return false;
      retryIO(() => rmdirSync(path));
    } else {
      if (process.platform === 'win32' && stat.nlink > 1 && !(stat.mode & 0o200)) throw Object.assign(new Error('read-only hard link'), { code: 'read-only hard link' });
      retryIO(() => unlinkSync(path));
    }
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    left.push(`${path} (${error.code ?? error.message})`);
    return false;
  }
}

function emptyDir(dir, left, skip) {
  let names;
  try { names = readdirSync(dir); }
  catch (error) { if (error.code === 'ENOENT') return true; left.push(`${dir} (${error.code ?? error.message})`); return false; }
  let clean = true;
  for (const name of names) if (name !== skip) clean = removeTree(join(dir, name), left) && clean;
  return clean;
}

function measure(path) {
  const stat = lstatSync(path);
  let bytes = stat.isDirectory() ? 0 : stat.size, newest = stat.mtimeMs;
  if (stat.isDirectory() && !stat.isSymbolicLink()) for (const name of readdirSync(path)) {
    try {
      const child = measure(join(path, name));
      bytes += child.bytes; newest = Math.max(newest, child.newest);
    } catch {}
  }
  return { bytes, newest };
}

const leftNote = (what, left) => `${what}: ${left.length} ${left.length === 1 ? 'entry' : 'entries'} could not be removed, first ${left[0]}. ff cleanup removes them later.`;

// Run start: folders whose run is confirmed over are removed at once, so a crash leaves nothing behind for long.
// A folder whose run cannot be confirmed over is kept.
export function sweepRunTemp(cwd, config, note = console.error) {
  for (const path of entries(runTempRoot(cwd, config))) {
    if (tempLive(path) !== false) continue;
    removeLink(jsonFile(join(path, OWNER))?.link, path);
    const left = [];
    if (!removeTree(path, left)) note(`Note: ${leftNote(`Old run temp folder ${path}`, left)}`);
  }
}

// ff cleanup and ff status: folders ff made on this machine that are older than a day and whose run is not confirmed live.
// A folder without the owner record may be the user's own, and another machine's run cannot be judged here; neither is listed.
export function staleRunTemp(cwd, config, cutoff = Date.now() - DAY) {
  return entries(runTempRoot(cwd, config)).flatMap(path => {
    try {
      const owner = jsonFile(join(path, OWNER));
      if (!owner || (owner.host && owner.host !== hostname()) || tempLive(path) === true) return [];
      const { bytes, newest } = measure(path);
      return newest < cutoff ? [{ path, bytes }] : [];
    } catch { return []; }
  });
}

export function removeRunTemp(path) {
  removeLink(jsonFile(join(path, OWNER))?.link, path);
  const left = [];
  removeTree(path, left);
  return left;
}

// ff run commits everything after a task, so <temp>/tmp must be ignored before anything writes there, whether or
// not the project ran ff init. The exclusion goes in the common git dir, so lane worktrees share it.
async function ignored(cwd, root) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.exitCode !== 0) return true;
  const repo = realPath(top.stdout.trim()), real = realPath(root);
  if (!inside(repo, real)) return true;
  const name = relative(repo, real);
  const probe = relative(cwd, join(root, 'x'));
  const check = async () => (await git(cwd, ['check-ignore', '-q', '--', probe])).exitCode === 0;
  if (await check()) return true;
  await excludeGitEntries(cwd, [`/${name.replaceAll('\\', '/')}/`]);
  return check();
}

// A short name keeps socket paths and deep tool paths under their limits: the run id's random suffix and lane
// letter. The full id is used when another run already holds the short name.
export function runTempName(id, root) {
  const full = String(id).replace(/[^\w.-]/g, '_').replace(/^\.*$/, name => `_${name}`);
  const short = String(id).match(/-([0-9a-f]{8}(?:-[A-Za-z])?)$/)?.[1];
  if (short && (!existsSync(join(root, short)) || jsonFile(join(root, short, OWNER))?.id === id)) return short;
  return full;
}

// Sweeps old folders, creates this run's folder, and points this process's TEMP, TMP and TMPDIR at it so every
// child inherits them. clear() empties it when a task settles; close() restores the variables and removes it, unless
// `keep` says a process that may use it is still alive. Failures are notes, never task failures.
export async function openRunTemp({ id, cwd, config, env = process.env, note = console.error }) {
  const root = runTempRoot(cwd, config);
  const unavailable = why => {
    note(`Note: run temp folder under ${root} is unavailable (${why}); processes use the usual temp folder.`);
    return { dir: null, clear: () => {}, close: () => {} };
  };
  sweepRunTemp(cwd, config, note);
  const name = runTempName(id, root), dir = join(root, name);
  let link;
  try {
    mkdirSync(dir, { recursive: true });
    if (lstatSync(root).isSymbolicLink() || lstatSync(dir).isSymbolicLink()) throw new Error('linked path');
    if (!await ignored(cwd, root)) { removeRunTemp(dir); return unavailable('it could not be git-ignored'); }
    // Tools create Unix sockets in TMPDIR, and a socket path stops at about 104 bytes. A deep project keeps its
    // files in the project but hands out a short link from the system temp folder.
    if (!socketSafe(dir)) {
      link = shortLink(dir, systemTemp(env), name);
      if (!link || !socketSafe(link)) {
        if (link) removeLink(link, dir);
        removeRunTemp(dir);
        return unavailable(`${dir} is too long for Unix socket paths, and no short link to it could be made in ${systemTemp(env)}`);
      }
    }
    writeFileSync(join(dir, OWNER), JSON.stringify({ id, cwd, pid: process.pid, host: hostname(), ...(link ? { link } : {}) }));
  } catch (error) {
    if (link) removeLink(link, dir);
    return unavailable(error.code ?? error.message);
  }
  const path = link ?? dir;
  const saved = [...tempKeys, 'FF_SYSTEM_TEMP'].map(key => [key, env[key]]);
  env.FF_SYSTEM_TEMP = systemTemp(env);
  for (const key of tempKeys) env[key] = path;
  let closed = false;
  return {
    dir,
    link,
    clear() {
      if (closed) return;
      const left = [];
      if (!emptyDir(dir, left, OWNER)) note(leftNote(`Run temp folder ${dir}`, left));
    },
    close({ keep = false } = {}) {
      if (closed) return;
      closed = true;
      for (const [key, value] of saved) if (value === undefined) delete env[key]; else env[key] = value;
      if (keep) return;
      if (link) removeLink(link, dir);
      const left = [];
      if (!removeTree(dir, left)) note(leftNote(`Run temp folder ${dir}`, left));
    },
  };
}
