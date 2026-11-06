import { openSync, closeSync, writeFileSync, readFileSync, renameSync, unlinkSync, mkdirSync, fsyncSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isAlive } from './proc.mjs';

export function retryIO(fn, delays = [50, 150, 450]) {
  for (let attempt = 0; ; attempt++) {
    try { return fn(); } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === delays.length) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
    }
  }
}
export function atomicWrite(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = retryIO(() => openSync(temp, 'wx', mode));
    writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
    retryIO(() => renameSync(temp, path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { retryIO(() => unlinkSync(temp)); } catch {}
  }
}
function readLock(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function acquireLock(path, force = false) {
  mkdirSync(dirname(path), { recursive: true });
  if (force) {
    try { retryIO(() => unlinkSync(path)); }
    catch (error) { if (error.code !== 'ENOENT') return { ok: false, reason: error.code }; }
  }
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = retryIO(() => openSync(path, 'wx', 0o600));
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token, host: hostname() })); }
      finally { closeSync(fd); }
      return { ok: true, path, token };
    } catch (error) {
      if (error.code !== 'EEXIST') return { ok: false, reason: error.code };
      const previous = readLock(path);
      if (previous?.host === hostname() && isAlive(previous.pid) === false) {
        try {
          if (readLock(path)?.token === previous.token) retryIO(() => unlinkSync(path));
        } catch (err) { return { ok: false, reason: err.code }; }
        continue;
      }
      // An incomplete fresh lock may still be getting written.
      let age = 0;
      try { age = Date.now() - statSync(path).mtimeMs; } catch {}
      if (!previous && age > 60000) {
        try { retryIO(() => unlinkSync(path)); } catch {}
        continue;
      }
      return { ok: false, reason: 'worktree may have another writer', pid: previous?.pid };
    }
  }
  return { ok: false, reason: 'worktree may have another writer' };
}
export function releaseLock(lock) {
  if (lock.ok && readLock(lock.path)?.token === lock.token) {
    try { retryIO(() => unlinkSync(lock.path)); return true; } catch {}
  }
  return false;
}
export function read(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}
export function jsonFile(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
