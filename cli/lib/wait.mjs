import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { latestRun } from './run.mjs';
import { jsonFile } from './fsx.mjs';
import { isAlive } from './proc.mjs';

export async function wait(args = [], cwd = process.cwd()) {
  let timeoutMs = Infinity;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--timeout-min') throw new Error(`Unknown wait option: ${args[i]}`);
    const minutes = Number(args[++i]);
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error('--timeout-min needs a non-negative number');
    timeoutMs = minutes * 60000;
  }
  const run = latestRun(cwd);
  if (!run) { console.log('No runs recorded.'); return 1; }
  const directory = join(cwd, '.ff/runs', run.id);
  const deadline = Date.now() + timeoutMs;
  const finish = (status, code) => {
    console.log(`Run ${run.id}: ${status}`);
    console.log(`Report: ${join(directory, 'summary.md')}`);
    return code;
  };
  for (;;) {
    let current = jsonFile(join(directory, 'run.json'));
    if (!current) return finish('run record unavailable', 1);
    if (current.status === 'running' && isAlive(current.pid) === false) {
      current = jsonFile(join(directory, 'run.json')) ?? current;
      if (current.status === 'running') return finish('interrupted; controller is dead', 1);
    }
    if (current.status !== 'running') return finish(current.status, current.status === 'done' ? 0 : 1);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return finish('running; wait timed out', 3);
    await setTimeout(Math.min(5000, remaining));
  }
}
