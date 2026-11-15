import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function retry(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return operation(); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      if (attempt === 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
}

// Never chmod a file to make cleanup succeed: it may share attributes with an external hard link.
function removeOwned(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const name of readdirSync(path)) removeOwned(join(path, name));
    retry(() => rmdirSync(path));
  } else {
    // Older Windows libuv unlinks can clear READONLY, including on another hard link.
    if (process.platform === 'win32' && stat.isFile() && stat.nlink > 1 && !(stat.mode & 0o200)) {
      throw Object.assign(new Error('Preserving shared read-only attributes'), { code: 'EREADONLYLINK', path });
    }
    retry(() => unlinkSync(path));
  }
}

// Importing this module is inert; only test and verification entry points create a scope.
export function createTempScope({ keep = false } = {}) {
  const scratch = fileURLToPath(new URL('../temp/scratch/', import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 't-'));
  // Shield fixtures from this ESM package while keeping Node's untyped CJS/ESM detection.
  writeFileSync(join(root, 'package.json'), '{}\n');
  Object.assign(process.env, { TEMP: root, TMP: root, TMPDIR: root });
  // Broken/removed fixture .git directories must not let Git discover this source repository.
  process.env.GIT_CEILING_DIRECTORIES = [root, process.env.GIT_CEILING_DIRECTORIES].filter(Boolean).join(delimiter);
  // Enable long paths for fixture Git calls inheriting this environment (the product Git wrapper clears it).
  if (process.platform === 'win32') {
    const count = Number(process.env.GIT_CONFIG_COUNT ?? 0);
    process.env[`GIT_CONFIG_KEY_${count}`] = 'core.longpaths';
    process.env[`GIT_CONFIG_VALUE_${count}`] = 'true';
    process.env.GIT_CONFIG_COUNT = String(count + 1);
  }
  // ff run keeps the usual TMPDIR when a project's run temp folder is too long for Unix socket paths, so fixtures
  // that need that folder outside Windows live in a short directory, removed with the scope.
  const short = [];
  const shortFixture = prefix => {
    if (process.platform === 'win32') return mkdtempSync(join(root, prefix));
    const path = mkdtempSync(join(realpathSync('/tmp'), prefix));
    short.push(path);
    return path;
  };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned || keep) return;
    try {
      while (short.length) { removeOwned(short[0]); short.shift(); }
      removeOwned(root);
      cleaned = true;
    } catch (error) {
      console.error(`Temporary cleanup failed for ${root}: ${error.code ?? error.message}${error.path ? ` (${error.path})` : ''}`);
      process.exitCode ||= 1;
    }
  };
  process.once('exit', cleanup);
  const removeFixture = (path) => {
    const index = short.indexOf(path);
    if (dirname(resolve(path)) !== root && index < 0) throw new Error(`Not an owned temporary fixture: ${path}`);
    removeOwned(path);
    if (index >= 0) short.splice(index, 1);
  };
  return { root, cleanup, removeFixture, shortFixture };
}
