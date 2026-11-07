import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { atomicWrite, jsonFile } from './fsx.mjs';
import { isAlive } from './proc.mjs';
import { executorIsLive, latestRun } from './run.mjs';

export const stopFile = cwd => join(cwd, '.ff/stop-request');
export const stoppedNote = 'Stopped by ff stop.';

// Asks the controller to stop, and it ends its own processes, so a stale pid can never hit an unrelated process.
export async function stop(args = [], cwd = process.cwd()) {
  let timeoutMs = 120000;
  for (let i = 0; i < args.length; i++) {
    const seconds = Number(args[++i]);
    if (args[i - 1] !== '--timeout-sec' || !Number.isFinite(seconds) || seconds < 0) { console.error('usage: ff stop [--timeout-sec <n>]'); return 2; }
    timeoutMs = seconds * 1000;
  }
  const run = latestRun(cwd);
  if (run?.kind !== 'plan' || run.status !== 'running') { console.log('No live run.'); return 0; }
  if (isAlive(run.pid) === false) {
    if (!executorIsLive(run)) { console.log(`Run ${run.id} has no live process. ff status shows where it stopped.`); return 0; }
    console.error(`The controller of run ${run.id} is gone, but pid ${run.executorPid} may still be its executor. Check that process yourself; nothing was killed.`);
    return 1;
  }
  atomicWrite(stopFile(cwd), `${run.id}\n`);
  const record = join(cwd, '.ff/runs', run.id, 'run.json');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = jsonFile(record);
    if (current && current.status !== 'running') {
      console.log(`Run ${run.id}: ${current.status}. Report: ${join(cwd, '.ff/runs', run.id, 'summary.md')}`);
      const trouble = current.stop && current.stop !== stoppedNote ? current.stop : executorIsLive(current) ? `pid ${current.executorPid} may still be running.` : '';
      const parked = Object.values(current.tasks ?? {}).map(task => task.parked).filter(Boolean);
      if (parked.length) console.log(`Unfinished work is on ${parked.join(', ')}.`);
      if (trouble) console.error(`The stop was not clean: ${trouble}`);
      return trouble ? 1 : 0;
    }
    if (Date.now() >= deadline) break;
    await setTimeout(Math.min(250, deadline - Date.now() + 1));
  }
  console.error(`Run ${run.id} has not stopped yet, so its controller may not be running, and nothing was killed. The request stays, and ff status shows the run.`);
  return 1;
}
