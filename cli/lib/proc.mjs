import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'ESRCH' ? false : 'unknown'; }
}

export function findCommand(command, env = process.env, cwd = process.cwd()) {
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const dirs = isAbsolute(command) || /[/\\]/.test(command) ? [''] : path.split(delimiter);
  const extensions = process.platform === 'win32' && !/\.(exe|cmd|bat)$/i.test(command) ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) for (const ext of extensions) {
    const candidate = resolve(cwd, dir.replace(/^"|"$/g, ''), command + ext);
    if (existsSync(candidate)) return candidate;
  }
  return command;
}

export function prepareSpawn(command, args = [], env = process.env, cwd) {
  const target = findCommand(command, env, cwd);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(target)) {
    const source = readFileSync(target, 'utf8');
    const match = source.match(/["']%(?:dp0%|~dp0)\\?([^"']+)["']\s+%\*/i);
    if (match) {
      const script = join(dirname(target), match[1].replace(/\\/g, '/'));
      if (/\.(c|m)?js$/i.test(script)) return { command: existsSync(join(dirname(target), 'node.exe')) ? join(dirname(target), 'node.exe') : process.execPath, args: [script, ...args] };
      if (/\.exe$/i.test(script)) return { command: script, args };
    }
    // Arbitrary batch files need their native interpreter.
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${[target, ...args].map(quote).join(' ')}"`], windowsVerbatimArguments: true };
  }
  return { command: target, args, windowsVerbatimArguments: process.platform === 'win32' && /(?:^|[/\\])cmd\.exe$/i.test(target) };
}

export function shellCommand(text, env = process.env) {
  return process.platform === 'win32'
    ? { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${text}"`] }
    : { command: '/bin/sh', args: ['-c', text] };
}

export function commandTemplate(text) {
  // Templates are executable plus arguments; acceptance commands use a shell.
  const words = [];
  let word = '', quote = '', started = false;
  for (const char of text) {
    if (quote) { if (char === quote) quote = ''; else word += char; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { words.push(word); word = ''; started = false; } }
    else { word += char; started = true; }
  }
  if (started) words.push(word);
  return { command: words[0], args: words.slice(1) };
}

const running = new Set();
export const unstopped = [];
const STOPPED = 'stopped by ff stop';
let stopping = false;

// Once stopping, nothing new starts. Git still runs, because saving the work needs it.
export function stopRunning() {
  stopping = true;
  for (const stop of [...running]) stop();
}

export function runProcess(command, args = [], options = {}) {
  return new Promise(resolveResult => {
    if (stopping && command !== 'git') { resolveResult({ pid: null, exitCode: null, signal: null, stdout: '', stderr: '', durationMs: 0, timedOut: true, idleTimedOut: false, reason: STOPPED, killedTree: true, error: null, outputTruncated: false }); return; }
    const start = Date.now();
    const stdout = [], stderr = [];
    let child, overall, idle, exited, finished = false, terminating = false;
    let outputTruncated = false;
    let idleTimedOut = false, timedOut = false, reason = null, killedTree = false, error = null;
    const env = { ...(options.env ?? process.env), FF_CHILD: '1' };
    for (const key of Object.keys(env)) if (/^(CLAUDECODE|CODEX_SANDBOX|CODEX_THREAD_ID)$/i.test(key)) delete env[key];
    const finish = (exitCode = null, signal = null) => {
      if (finished || terminating) return;
      finished = true;
      running.delete(stop);
      clearTimeout(overall);
      clearTimeout(idle);
      clearTimeout(exited);
      resolveResult({ pid: child?.pid ?? null, exitCode, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), durationMs: Date.now() - start, timedOut, idleTimedOut, reason, killedTree, error, outputTruncated });
    };
    const terminate = async why => {
      if (finished || terminating) return;
      terminating = true;
      timedOut = true;
      reason = why;
      idleTimedOut = why === 'idle timeout: process went silent';
      clearTimeout(idle);
      if (process.platform === 'win32') {
        const taskkill = join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe');
        const result = spawnSync(taskkill, ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 10000 });
        killedTree = result.status === 0 ? true : 'unknown';
        if (result.status !== 0) { error = `taskkill status ${result.status}`; child.kill(); }
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        await new Promise(done => setTimeout(done, options.killGraceMs ?? 1000));
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        killedTree = 'unknown';
        for (let probe = 0; probe < 20 && killedTree !== true; probe++) {
          try { process.kill(-child.pid, 0); await new Promise(done => setTimeout(done, 100)); }
          catch (err) { if (err.code === 'ESRCH') killedTree = true; else break; }
        }
      }
      terminating = false;
      // Release pipe handles even if a surviving descendant retained them.
      if (why === STOPPED && killedTree !== true) unstopped.push(child.pid);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      finish(null, 'SIGKILL');
    };
    const stop = () => terminate(STOPPED);
    const resetIdle = () => {
      clearTimeout(idle);
      if (!finished && !terminating && options.idleMs > 0) idle = setTimeout(() => terminate('idle timeout: process went silent'), options.idleMs);
    };
    try {
      const prepared = prepareSpawn(command, args, env, options.cwd);
      child = spawn(prepared.command, prepared.args, { ...prepared, cwd: options.cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('error', err => { error = err.message; finish(); });
      child.on('close', (code, signal) => finish(code, signal));
      // A background service can hold the pipes long after the process itself exits.
      child.on('exit', (code, signal) => {
        exited = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(code, signal); }, options.exitGraceMs ?? 5000);
      });
      const sizes = new Map();
      const capture = chunks => chunk => {
        resetIdle();
        const limit = options.maxOutputBytes ?? 4 * 1024 * 1024;
        chunks.push(Buffer.from(chunk));
        let size = (sizes.get(chunks) ?? 0) + chunk.length;
        while (size > limit && chunks.length) {
          outputTruncated = true;
          const excess = size - limit;
          const first = chunks[0];
          if (first.length <= excess) { size -= first.length; chunks.shift(); }
          else { chunks[0] = Buffer.from(first.subarray(excess)); size -= excess; }
        }
        sizes.set(chunks, size);
      };
      child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr));
      child.stdin.on('error', err => { if (err.code !== 'EPIPE') error = err.message; });
      if (command !== 'git') running.add(stop);
      options.onSpawn?.(child.pid);
      child.stdin.end(options.input ?? '');
      resetIdle();
      if (options.timeoutMs > 0) overall = setTimeout(() => terminate('overall timeout'), options.timeoutMs);
    } catch (err) { error = err.message; if (child?.pid) terminate('startup recording failed'); else finish(); }
  });
}
