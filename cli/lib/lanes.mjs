import { posix, basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { git, withLaneGit, commitPaths } from './git.mjs';
import { planPath, planningFile, tempDir } from './paths.mjs';
import { readPlan, setBox, writePlan } from './plan.mjs';
import { atomicWrite, jsonFile } from './fsx.mjs';
import { isAlive, runProcess, shellCommand } from './proc.mjs';
import { archiveIgnored, listWorktrees, liveRun, noLinks } from './worktree.mjs';

export const laneRecord = lane => lane.childId ? jsonFile(join(lane.path, '.ff/runs', lane.childId, 'run.json')) : null;
export function laneIsLive(lane, child = laneRecord(lane)) {
  const lock = jsonFile(join(lane.path, '.ff/run.lock'));
  return [child?.pid, child?.executorPid, lock?.pid, lane.pid].some(pid => pid && isAlive(pid) !== false);
}
export function forwardLaneStop(run) {
  for (const lane of run.lanes ?? []) if (lane.path && !lane.merged && laneIsLive(lane)) {
    atomicWrite(join(lane.path, '.ff/stop-request'), `${lane.childId}\n`);
  }
}
export function laneSummary(lane) {
  return `- Lane ${lane.letter}: ${lane.tasks.join(', ')}; ${lane.attempts ?? 0} attempts; duration ${lane.durationMs ?? 0} ms; ${lane.merged ? 'merged' : 'not merged'} (${lane.status})${lane.error ? `; ${lane.error}` : ''}${lane.outsideFiles?.length ? `; writes outside Files: ${lane.outsideFiles.join(', ')}` : ''}${lane.path && !lane.cleanup?.removed ? `; kept ${lane.path}${lane.cleanup?.reason ? `: ${lane.cleanup.reason}` : ''}` : ''}`;
}

// Detached controllers own their locks and stop their own executors. The parent only observes them.
export async function runLanes(run, { count, cli, save, checkStop }) {
  return withLaneGit(async () => {
    if (!run.lanes) {
      const plan = readPlan(run.cwd, run.plan, run.config);
      const grouped = planLanes({ ...plan, path: run.plan, tasks: plan.tasks.filter(task => !run.only || run.only.includes(task.id)) }, { lanes: count });
      run.lanes = grouped.lanes.map((tasks, index) => ({ letter: String.fromCharCode(97 + index), tasks, checkpoint: run.good, status: 'pending', merged: false }));
      save(run);
    }
    const refresh = lane => {
      const child = lane.path ? laneRecord(lane) : null;
      if (child) {
        lane.status = child.current?.startsWith('provider limit:') ? 'waiting' : child.status;
        lane.attempts = Object.values(child.tasks ?? {}).reduce((sum, task) => sum + (task.attempts ?? 0), 0);
      }
      return child;
    };
    for (;;) {
      checkStop(run);
      let active = 0, waiting = false;
      for (const lane of run.lanes.filter(lane => lane.childId && !lane.merged && !lane.handled)) {
        const child = refresh(lane);
        if (!child && !lane.pid && ['starting', 'ready'].includes(lane.status)) {
          // If launch recording was interrupted, the child's own lock arbitrates a retry.
          if (laneIsLive(lane, child)) { lane.status = 'starting'; active++; }
          else lane.status = 'ready';
          continue;
        }
        if (child?.executorPid && (child.status !== 'running' || (isAlive(child.executorPid) !== false && isAlive(child.pid) === false))) {
          lane.handled = true;
          run.stop = `Lane ${lane.letter}: executor tree at pid ${child.executorPid} may still be alive; work left intact.`;
          continue;
        }
        if (laneIsLive(lane, child)) { active++; waiting ||= lane.status === 'waiting'; continue; }
        lane.durationMs = lane.startedAt ? Date.now() - Date.parse(lane.startedAt) : 0;
        if (run.stop) {
          if (child?.stop && child.stop !== 'Stopped by ff stop.') run.stop = `Lane ${lane.letter}: ${child.stop}`;
          lane.handled = true; continue;
        }
        if (lane.status === 'setup-failed') { lane.handled = true; continue; }
        try {
          const result = await mergeLane({ cwd: run.cwd, config: run.config, lane, runBranch: run.branch, tasks: readPlan(run.cwd, run.plan, run.config).tasks, child, planFile: resolve(run.cwd, run.plan), timeoutMs: run.minutes * 60000, shouldStop: () => { checkStop(run); return Boolean(run.stop); } });
          Object.assign(lane, result);
          for (const id of result.done) run.tasks[id] = { ...child?.tasks?.[id], status: 'done' };
          for (const id of result.tail) if (result.acceptance[id]?.note) {
            run.tasks[id] = { note: result.acceptance[id].note };
            run.planNotes.push(`${id}: ${result.acceptance[id].note}`);
          }
          if (result.treeUnconfirmed) { run.executorPid = result.pid; run.stop = `Lane integration process may still be alive (pid ${result.pid}).`; }
          run.good = (await output(run.cwd, ['rev-parse', 'HEAD'])).trim();
          save(run);
          if (lane.merged && !result.treeUnconfirmed) lane.cleanup = await cleanLane({ cwd: run.cwd, config: run.config, lane, runBranch: run.branch, parentDir: run.dir });
        } catch (error) {
          lane.error = error.message;
          run.stop = `Lane ${lane.letter}: ${error.message}`;
        }
        lane.handled = true;
        save(run);
      }
      if (run.stop) forwardLaneStop(run);
      if (!run.stop && !waiting && active < count) {
        const pending = run.lanes.find(lane => ['pending', 'ready'].includes(lane.status));
        if (pending) {
          if (pending.status === 'pending') {
            Object.assign(pending, await createLane({ cwd: run.cwd, config: run.config, runId: run.id, letter: pending.letter, tasks: pending.tasks, checkpoint: pending.checkpoint }));
            if (pending.status === 'setup-failed') pending.handled = true;
            save(run);
            continue;
          }
          if (pending.status === 'ready' && !run.stop) {
            pending.childId = `${run.id}-${pending.letter}`;
            pending.startedAt = new Date().toISOString();
            pending.status = 'starting';
            save(run);
            const log = join(pending.path, '.ff/runs', pending.childId, 'controller.log');
            atomicWrite(log, '');
            const fd = openSync(log, 'a');
            try {
              const child = spawn(process.execPath, [cli, 'run', '--all', '--foreground', '--only', pending.tasks.join(','), '--id', pending.childId, '--plan', run.plan, '--timeout-min', String(run.minutes)], {
                cwd: pending.path, detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
                env: { ...process.env, FF_LANE: pending.letter, FF_LANE_CONFIG: JSON.stringify(run.config), FF_CHILD: '1' },
              });
              pending.pid = child.pid;
              child.once('error', error => { pending.error = error.message; pending.status = 'setup-failed'; save(run); });
              child.unref();
            } finally { closeSync(fd); }
            save(run);
          } else pending.handled = true;
          continue;
        }
      }
      save(run);
      if (!active && (run.stop || run.lanes.every(lane => lane.handled || lane.merged))) break;
      await new Promise(done => setTimeout(done, 100));
    }
  });
}

const normalize = file => {
  const path = posix.normalize(file.replaceAll('\\', '/')).replace(/^\.\//, '');
  return process.platform === 'win32' ? path.toLowerCase() : path;
};
const prefix = file => normalize(file).split(/[*?{[]/, 1)[0];
const overlaps = (a, b) => {
  const left = prefix(a), right = prefix(b);
  return left.startsWith(right) || right.startsWith(left);
};

function serialReason(plan, task) {
  if (!task.files?.length) return 'no Files declared';
  if ((task.risk ?? plan.risk) === 'high') return 'high risk';
  const wide = task.files.find(file => {
    const path = normalize(file), name = posix.basename(path).toLowerCase();
    return !prefix(file).includes('/') || path === normalize(plan.path ?? 'PLAN.md')
      || /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|composer\.lock|poetry\.lock|uv\.lock|gemfile\.lock|plan\.md|decisions\.md)$/.test(name);
  });
  return wide ? `repository-wide path: ${wide}` : '';
}

export function planLanes(plan, { lanes = 2 } = {}) {
  const tasks = plan.tasks.filter(task => !task.done), groups = [], reasons = {};
  for (const task of tasks) {
    const connected = groups.filter(group => group.some(other =>
      task.depends?.includes(other.id) || other.depends?.includes(task.id)
      || task.files?.some(file => other.files?.some(candidate => overlaps(file, candidate)))
      || task.shared?.some(resource => other.shared?.includes(resource))));
    const group = [...connected.flat(), task];
    for (const old of connected) groups.splice(groups.indexOf(old), 1);
    groups.push(group);
    const reason = serialReason(plan, task);
    if (reason) reasons[task.id] = reason;
  }
  const parallel = [], tail = [];
  for (const group of groups) {
    group.sort((a, b) => tasks.indexOf(a) - tasks.indexOf(b));
    const serial = group.find(task => reasons[task.id]);
    if (serial) for (const task of group) {
      reasons[task.id] ??= `connected to serial task ${serial.id}`;
      tail.push(task.id);
    }
    else parallel.push(group.map(task => task.id));
  }
  parallel.sort((a, b) => tasks.findIndex(task => task.id === a[0]) - tasks.findIndex(task => task.id === b[0]));
  const result = Array.from({ length: Math.min(lanes, parallel.length) }, () => []);
  for (const group of parallel) {
    const target = result.reduce((best, lane) => lane.length < best.length ? lane : best);
    target.push(...group);
  }
  tail.sort((a, b) => tasks.findIndex(task => task.id === a) - tasks.findIndex(task => task.id === b));
  return { lanes: result, tail, reasons };
}

const inside = (root, path) => {
  const name = relative(root, path);
  return Boolean(name && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name));
};
async function output(cwd, args) {
  const result = await git(cwd, args, { timeoutMs: 600000 });
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated || result.error) throw new Error(result.stderr || result.error || `git ${args[0]} failed`);
  return result.stdout;
}
async function laneRoot(cwd, config) {
  if (config.paths?.worktrees) return resolve(cwd, config.paths.worktrees);
  const main = dirname(resolve(cwd, (await output(cwd, ['rev-parse', '--git-common-dir'])).trim()));
  return resolve(main, '..', `${basename(main)}-worktree`);
}
async function cleanRun(cwd, branch) {
  if ((await output(cwd, ['symbolic-ref', '--short', 'HEAD'])).trim() !== branch) throw new Error('run branch changed');
  if ((await output(cwd, ['status', '--porcelain', '--untracked-files=all'])).trim()) throw new Error('run tree must be clean');
}

// The parent owns scheduling and persistence; these helpers return tail tasks and evidence.
export function createLane({ cwd, config = {}, runId, letter, tasks, checkpoint }) {
  return withLaneGit(async () => {
    const root = await laneRoot(cwd, config);
    const lane = { letter, tasks, checkpoint, path: resolve(root, `ff-${runId.slice(-8)}-${letter}`), branch: `ff/lane/${runId.slice(0, 19)}/${letter}`, status: 'ready', merged: false };
    try {
      if (!inside(root, lane.path)) throw new Error('lane path outside worktree root');
      noLinks(lane.path, root);
      if (existsSync(lane.path)) throw new Error(`Worktree path exists: ${lane.path}`);
      await output(cwd, ['worktree', 'add', '-b', lane.branch, '--', lane.path, checkpoint]);
      if (config.run?.laneSetup) {
        const shell = shellCommand(config.run.laneSetup);
        const setup = await runProcess(shell.command, shell.args, { cwd: lane.path, timeoutMs: 600000 });
        if (setup.exitCode !== 0 || setup.timedOut || setup.error) throw new Error(`lane setup failed: ${setup.stderr || setup.error || setup.stdout || setup.exitCode}`);
      }
      for (const name of config.run?.laneCopy ?? []) {
        const source = resolve(cwd, name), target = resolve(lane.path, name);
        if (isAbsolute(name) || !inside(cwd, source) || !inside(lane.path, target) || name.replaceAll('\\', '/').toLowerCase().split('/').includes('.git')) throw new Error(`laneCopy needs an exact relative file path: ${name}`);
        noLinks(source, cwd); noLinks(target, lane.path);
        mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
      }
    } catch (error) { lane.status = 'setup-failed'; lane.tail = [...tasks]; lane.error = error.message; }
    return lane;
  });
}

function matches(file, glob) {
  let pattern = '';
  glob = normalize(glob);
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { pattern += '(?:.*/)?'; i++; } else pattern += '.*';
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`).test(normalize(file));
}

export function mergeLane({ cwd, config = {}, lane, runBranch, tasks, child, planFile = planPath(cwd, config), timeoutMs = 600000, shouldStop = () => false }) {
  return withLaneGit(async () => {
    await cleanRun(cwd, runBranch);
    const tip = (await output(cwd, ['rev-parse', `refs/heads/${lane.branch}`])).trim();
    child ??= lane.childId ? jsonFile(join(lane.path, '.ff/runs', lane.childId, 'run.json')) : null;
    const selected = tasks.filter(task => lane.tasks.includes(task.id));
    const done = selected.filter(task => child?.tasks?.[task.id]?.status === 'done').map(task => task.id);
    const decisions = planningFile(cwd, config, 'DECISIONS.md');
    const planName = relative(cwd, planFile).replaceAll('\\', '/'), decisionName = relative(cwd, decisions).replaceAll('\\', '/');
    const parentPlan = readFileSync(planFile, 'utf8');
    const parentDecisions = existsSync(decisions) ? readFileSync(decisions, 'utf8') : '';
    const hasDecisions = (await output(cwd, ['ls-tree', '--name-only', tip, '--', decisionName])).trim();
    const childDecisions = hasDecisions ? await output(cwd, ['show', `${tip}:${decisionName}`]) : '';
    const changed = (await output(cwd, ['diff', '--name-only', '--no-renames', '-z', `${lane.checkpoint}..${tip}`, '--'])).split('\0').filter(Boolean);
    const outsideFiles = changed.filter(file => file !== planName && file !== decisionName && !selected.some(task => task.files?.some(glob => matches(file, glob))));
    const result = { merged: false, tip, done: [], tail: [...lane.tasks], outsideFiles, acceptance: {} };
    if (shouldStop()) return result;
    const merged = await git(cwd, ['-c', 'commit.gpgsign=false', 'merge', '--no-ff', '--no-verify', '--no-commit', tip], { timeoutMs });
    const conflicts = (await output(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean);
    if (merged.exitCode !== 0 && (!conflicts.length || conflicts.some(file => ![planName, decisionName].includes(file)))) {
      const pending = await git(cwd, ['rev-parse', '--verify', 'MERGE_HEAD']);
      if (pending.exitCode === 0) await output(cwd, ['merge', '--abort']);
      await cleanRun(cwd, runBranch);
      result.error = merged.stderr || merged.error || 'merge failed'; result.conflicts = conflicts;
      return result;
    }
    // Lane metadata never replaces the parent's task definitions or unrelated ticks.
    writePlan(cwd, planFile, parentPlan);
    for (const task of selected) setBox(cwd, planFile, task.id, done.includes(task.id));
    if (parentDecisions || hasDecisions) {
      const lines = parentDecisions.split(/\r?\n/);
      while (lines.at(-1) === '') lines.pop();
      for (const line of childDecisions.split(/\r?\n/)) if (line && !lines.includes(line)) lines.push(line);
      mkdirSync(dirname(decisions), { recursive: true }); atomicWrite(decisions, `${lines.join('\n')}\n`);
    }
    await output(cwd, ['add', '--', planName, ...(existsSync(decisions) ? [decisionName] : [])]);
    const pending = await git(cwd, ['rev-parse', '--verify', 'MERGE_HEAD']);
    if (pending.exitCode === 0) await output(cwd, ['-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', `Merge lane ${lane.letter}`]);
    result.merged = true;
    for (const task of selected.filter(task => done.includes(task.id))) {
      const commands = [];
      for (const command of task.accept) {
        const shell = shellCommand(command), checked = await runProcess(shell.command, shell.args, { cwd, timeoutMs });
        commands.push({ command, passed: checked.exitCode === 0 && !checked.timedOut && !checked.error, exitCode: checked.exitCode, output: `${checked.stdout}\n${checked.stderr}\n${checked.error ?? ''}`.slice(-6000) });
        if (checked.timedOut && checked.killedTree !== true) {
          result.treeUnconfirmed = true; result.pid = checked.pid; break;
        }
      }
      const passed = commands.length > 0 && commands.every(command => command.passed);
      result.acceptance[task.id] = { commands, passed, ...(!passed ? { note: 'passed in its lane, failed after merging' } : {}) };
      setBox(cwd, planFile, task.id, passed);
      if (passed) result.done.push(task.id);
      if (result.treeUnconfirmed) break;
    }
    for (const task of selected) if (!result.done.includes(task.id)) setBox(cwd, planFile, task.id, false);
    const saved = await commitPaths(cwd, `Verify lane ${lane.letter} integration`, [planName]);
    if (!saved.ok) throw new Error(saved.error);
    result.tail = lane.tasks.filter(id => !result.done.includes(id));
    return result;
  });
}

export function cleanLane({ cwd, config = {}, lane, runBranch, parentDir }) {
  return withLaneGit(async () => {
    try {
      const root = await laneRoot(cwd, config), path = resolve(lane.path);
      const same = other => existsSync(other) && existsSync(path) && realpathSync.native(other) === realpathSync.native(path);
      const entries = await listWorktrees(cwd), entry = entries.find(entry => same(entry.path));
      if (!entry || !inside(root, path) || same(entries[0].path) || same(cwd)) throw new Error('not a removable lane worktree');
      if (/backup|bak|备份/i.test(path)) throw new Error('backup name');
      noLinks(path, root);
      if (!inside(realpathSync(root), realpathSync(path))) throw new Error('path resolves outside worktree root');
      if (!entry.branch || entry.branch !== lane.branch) throw new Error('lane branch changed');
      const check = async () => {
        if ((await output(path, ['status', '--porcelain', '--untracked-files=all'])).trim()) throw new Error('dirty worktree');
        if (liveRun(join(path, '.ff/runs'))) throw new Error('run process alive');
        if ((await output(path, ['symbolic-ref', '--short', 'HEAD'])).trim() !== entry.branch || (await output(cwd, ['rev-parse', `refs/heads/${entry.branch}`])).trim() !== entry.head) throw new Error('lane branch changed');
        await output(cwd, ['merge-base', '--is-ancestor', entry.head, `refs/heads/${runBranch}`]);
      };
      await check();
      const temp = tempDir(cwd, config), archive = join(temp, 'worktree-archive', relative(root, path));
      const runsArchive = resolve(parentDir, 'lanes', lane.letter, 'runs');
      if (!inside(resolve(parentDir, 'lanes'), runsArchive)) throw new Error('run archive outside parent directory');
      noLinks(runsArchive, cwd);
      const kept = await archiveIgnored(path, archive, temp, true, runsArchive);
      if (kept.length) throw new Error(kept.join('; '));
      await check();
      if (liveRun(runsArchive) || liveRun(join(archive, '.ff/runs'))) throw new Error('run process alive');
      await output(cwd, ['worktree', 'remove', '--', path]);
      const deleted = await git(cwd, ['update-ref', '-d', `refs/heads/${entry.branch}`, entry.head]);
      const pruned = await git(cwd, ['worktree', 'prune']);
      return { removed: true, ...(deleted.exitCode !== 0 || pruned.exitCode !== 0 ? { reason: deleted.stderr || pruned.stderr } : {}) };
    } catch (error) { return { removed: false, reason: error.message }; }
  });
}
