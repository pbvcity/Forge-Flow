import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptFileArgs, readConfig, resolveBuilder } from './config.mjs';
import { acquireLock, releaseLock, atomicWrite, read } from './fsx.mjs';
import { runProcess, shellCommand, stopRunning, unstopped } from './proc.mjs';
import { commitAll, commitPaths, excludeGitEntries, git, startRunBranch } from './git.mjs';
import { holdOn, parsePlan, readPlan, setBox, writePlan } from './plan.mjs';
import { attempt, decisionLines, executorIsLive, invocation, latestRun, newId, runExcludes, runIsLive, workerPrompt } from './run.mjs';
import { auditDiff } from './audit.mjs';
import { stopFile, stoppedNote } from './stop.mjs';
import { notifyRun } from './notify.mjs';
import { readDiff } from './diff.mjs';
import { reviewChange } from './review.mjs';

const cli = fileURLToPath(new URL('../ff.mjs', import.meta.url));
const reviewedTiers = ['contract', 'high'];
const maxLeadRuns = 3;
const sleep = minutes => new Promise(done => setTimeout(done, minutes * 60000));
const riskOf = (plan, task) => task.risk ?? plan.risk ?? 'routine';

function parseArgs(args) {
  const options = { minutes: 60, force: false, foreground: false, plan: 'PLAN.md', id: '' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--all') continue;
    if (flag === '--force') options.force = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--foreground') options.foreground = true;
    else if (flag === '--timeout-min') options.minutes = Number(args[++i]);
    else if (flag === '--plan') options.plan = args[++i];
    else if (flag === '--id') options.id = args[++i];
    else throw new Error(`Unknown run --all option: ${flag}`);
  }
  if (!(options.minutes > 0 && Number.isFinite(options.minutes))) throw new Error('--timeout-min must be a positive number');
  if (!options.plan) throw new Error('--plan needs a path');
  return options;
}

async function detach(args, cwd, id) {
  const dir = join(cwd, '.ff/runs', id), logPath = join(dir, 'controller.log');
  atomicWrite(logPath, '');
  const fd = openSync(logPath, 'a');
  let child;
  try { child = spawn(process.execPath, [cli, 'run', ...args, '--foreground', '--id', id], { cwd, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] }); }
  finally { closeSync(fd); }
  let exitCode = null;
  child.once('exit', code => { exitCode = code ?? 1; });
  const deadline = Date.now() + 15000;
  while (exitCode === null && !existsSync(join(dir, 'run.json')) && Date.now() < deadline) await sleep(0.001);
  child.unref();
  if (exitCode !== null && !existsSync(join(dir, 'run.json'))) { console.error(read(logPath).trim()); return exitCode; }
  console.log(`${id}: running in the background (pid ${child.pid}). ff status shows progress.`);
  return 0;
}

function section(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next < 0 ? undefined : next).trim();
}

function playbookRules(root) {
  const playbook = read(join(root, 'playbook/default.md'));
  const keyPoints = section(read(join(root, 'skills/go/SKILL.md')), '## 5. Key points').replace('../../playbook/packs/', 'the packs folder named below');
  return [section(playbook, '## When to stop'), section(playbook, '## Business decisions'), keyPoints].join('\n\n');
}

function taskCard(run, plan, task, evidence) {
  const lines = [
    `# ${task.id} ${task.title}`,
    `Risk: ${riskOf(plan, task)}`,
    `Worktree: ${run.cwd}`,
    `Goal: ${plan.goal}${plan.outcome ? ` — ${plan.outcome}` : ''}`,
    '',
    '## Task',
    ...task.details,
    '',
    '## Acceptance',
    'The tool runs these after you exit. Run them yourself first.',
    'Do only this task. Other tasks in the plan run separately, and doing them here counts against it.',
    ...task.accept.map(command => `- \`${command}\``),
    '',
    '## This run',
    'Nobody is watching and nobody will answer. Make the decisions yourself under the rules below.',
    `The tool commits, ticks ${run.plan}, and reviews. Do not commit, switch branches, or open a PR. Leave ${run.plan} alone.`,
    'Report: write the report file named at the end of this prompt, once, when you finish. First line: DONE, or BLOCKED: <reason> only for a line under "When to stop". Then what changed, what you ran, deviations.',
    `The full playbook is ${join(run.root, 'playbook/default.md')}, with subject packs in ${join(run.root, 'playbook/packs')}. Read the ones that fit if you can reach them.`,
    '',
    run.rules,
  ];
  if (evidence) lines.push('', '## Previous attempt failed', evidence, '', 'Fix this, and rerun only what the fix touches before the acceptance. The acceptance above stays as it is.');
  return lines.join('\n');
}

function save(run) {
  const { id, plan, branch, pid, startedAt, status, current, currentSince, note, stop, executorPid, tasks } = run;
  atomicWrite(join(run.dir, 'run.json'), JSON.stringify({ id, kind: 'plan', plan, branch, pid, startedAt, status, current, currentSince, note, stop, executorPid, tasks }, null, 2));
}

function settle(run, task, status, fields = {}) {
  run.settled.add(task.id);
  run.tasks[task.id] = { ...run.tasks[task.id], title: task.title, status, ...fields };
  run.current = '';
  save(run);
}

const parkName = (run, task) => `ff/failed/${run.id.slice(0, 19)}/${task.id}-${++run.parks}`;
const resetTo = (run, commit) => git(run.cwd, ['reset', '-q', '--hard', '--recurse-submodules', commit], { timeoutMs: 120000 });

// A stopped task's work is parked on a branch, so independent tasks start clean and nothing is lost.
// If it cannot be saved, the tree stays exactly as it is and the run stops.
async function parkWork(run, task) {
  if (!run.repo) return '';
  const keep = [run.plan, 'DECISIONS.md'].map(path => [path, read(resolve(run.cwd, path))]);
  const saved = await commitAll(run.cwd, `ff: unfinished ${task.id}`);
  if (!saved.ok) { run.stop = `${task.id}: its work could not be saved, so the worktree was left as it is. ${saved.error}`; return ''; }
  const left = await git(run.cwd, ['status', '--porcelain'], { timeoutMs: 120000 });
  if (left.exitCode !== 0 || left.stdout.trim()) { run.stop = `${task.id}: changes remain that a commit cannot hold, such as inside a submodule, so the worktree was left as it is.`; return ''; }
  let name = '';
  if (saved.head !== run.good) {
    name = parkName(run, task);
    const branch = await git(run.cwd, ['branch', name, saved.head]);
    if (branch.exitCode !== 0) { run.stop = `${task.id}: its work is at commit ${saved.head}, but ${name} could not be created. ${branch.stderr}`; return ''; }
  }
  const reset = await resetTo(run, run.good);
  if (reset.exitCode !== 0) { run.stop = `${task.id}: the worktree could not return to the last good commit. ${reset.stderr}`; return name; }
  for (const [path, text] of keep) if (text) writePlan(run.cwd, path, text);
  const notes = await commitPaths(run.cwd, `ff: plan notes after ${task.id}`, [run.plan, 'DECISIONS.md']);
  if (notes.head) run.good = notes.head;
  return name;
}

function mergeDecisions(run, decisions) {
  const current = read(join(run.cwd, 'DECISIONS.md')), have = new Set(current.split(/\r?\n/));
  const added = decisions.split(/\r?\n/).filter(line => line.trim() && !have.has(line));
  if (added.length) writePlan(run.cwd, 'DECISIONS.md', `${current.trimEnd()}${current.trim() ? '\n' : ''}${added.join('\n')}\n`);
}

// Any process may have moved HEAD. Its work is kept, and the run goes back to its own branch.
async function returnToBranch(run, task) {
  if (!run.repo) return '';
  const current = (await git(run.cwd, ['branch', '--show-current'])).stdout.trim();
  if (current === run.branch) return '';
  const name = parkName(run, task), decisions = read(join(run.cwd, 'DECISIONS.md'));
  await git(run.cwd, ['switch', '-q', '-c', name]);
  await commitAll(run.cwd, `ff: unfinished ${task.id}`);
  const back = await git(run.cwd, ['switch', '-q', run.branch]);
  if (back.exitCode !== 0) run.stop = `${task.id} left the run branch and it could not be restored. ${back.stderr}`;
  else mergeDecisions(run, decisions);
  return `the process left the run branch (${current || 'detached HEAD'}); its work is on ${name}`;
}

function snapshotPlan(run) {
  const plan = readPlan(run.cwd, run.plan, run.config);
  atomicWrite(join(run.dir, 'plan-before.md'), plan.text);
  return plan;
}

function planChanges(before, after) {
  const old = new Map(before.tasks.map(task => [task.id, task]));
  const ids = new Set(after.tasks.map(task => task.id));
  return {
    added: after.tasks.filter(task => !old.has(task.id)).map(task => task.id),
    removed: before.tasks.filter(task => !ids.has(task.id)).map(task => task.id),
    changed: after.tasks.filter(task => old.has(task.id) && old.get(task.id).signature !== task.signature).map(task => task.id),
    acceptChanged: after.tasks.filter(task => old.has(task.id) && old.get(task.id).accept.join('\n') !== task.accept.join('\n')).map(task => task.id),
  };
}

function describeChanges({ added, removed, changed, acceptChanged }) {
  const parts = [[added, 'added'], [removed, 'removed'], [changed, 'changed'], [acceptChanged, 'changed the acceptance of']];
  return parts.filter(([ids]) => ids.length).map(([ids, verb]) => `${verb} ${ids.join(', ')}`).join('; ');
}

// The rejected text may include a person's edits, so it is kept.
function restorePlan(run, before, note) {
  const rejected = read(resolve(run.cwd, run.plan));
  const name = `plan-rejected-${run.planNotes.length + 1}.md`;
  if (rejected) atomicWrite(join(run.dir, name), rejected);
  writePlan(run.cwd, run.plan, before.text);
  run.planNotes.push(rejected ? `${note} The rejected text is in ${join('.ff/runs', run.id, name)}.` : note);
}

function lowersAGate(before, after) {
  const held = new Set(after.holds.map(item => `${item.id} ${item.reason}`));
  if (before.holds.some(item => !held.has(`${item.id} ${item.reason}`)) || before.risk !== after.risk) return true;
  const ids = new Set(after.tasks.map(task => task.id));
  if (before.holds.some(item => item.id !== '*' && before.tasks.some(task => task.id === item.id) && !ids.has(item.id))) return true;
  return after.tasks.some(task => {
    const old = before.tasks.find(item => item.id === task.id);
    return old && old.risk !== task.risk;
  });
}

// Runs after every process. Only the tool ticks tasks, holds and tiers stay, the exit condition stays, and every change to the plan is reported.
function guardPlan(run, before, who) {
  let after;
  try { after = readPlan(run.cwd, run.plan, run.config); } catch {}
  if (!after || (before.tasks.length && !after.tasks.length)) {
    restorePlan(run, before, `${who} damaged ${run.plan}; restored.`);
    return { edited: false };
  }
  if (lowersAGate(before, after)) {
    restorePlan(run, before, `${who} tried to lift a hold or lower a risk tier; ${run.plan} restored.`);
    return { edited: false };
  }
  const ticked = new Set(before.tasks.filter(task => task.done).map(task => task.id));
  for (const task of after.tasks) if (task.done && !ticked.has(task.id)) setBox(run.cwd, run.plan, task.id, false);
  if (after.exit !== before.exit) {
    const line = /^\s*Exit condition:.*$/m, saved = before.text.match(line)?.[0];
    const text = readPlan(run.cwd, run.plan, run.config).text;
    writePlan(run.cwd, run.plan, saved && line.test(text) ? text.replace(line, () => saved) : before.text);
    run.planNotes.push(`${who} tried to change the exit condition; undone.`);
  }
  const changes = planChanges(before, readPlan(run.cwd, run.plan, run.config));
  const summary = describeChanges(changes);
  if (summary) run.planNotes.push(`${who} ${summary}.`);
  if (changes.removed.length || changes.acceptChanged.length) run.criteriaChanged = true;
  return { edited: Boolean(summary), changes };
}

async function checkChange(run, plan, task) {
  const diff = run.repo ? await readDiff(run.cwd, run.good).catch(() => '') : '';
  const warnings = auditDiff(diff).weakened ? ['tests weakened: read this diff'] : [];
  const risk = riskOf(plan, task);
  if (run.repo && !diff.trim()) warnings.push('no files changed');
  if (!reviewedTiers.includes(risk) || !run.repo) return { warnings, review: `not reviewed (${risk})` };
  const scope = `This is one task of a larger plan. Judge only this task; other tasks run separately.\n${task.id} ${task.title}\n${task.details.join('\n')}\nAccept:\n${task.accept.join('\n')}`;
  const review = await reviewChange({ root: run.root, cwd: run.cwd, config: run.config, base: run.good, risk, plan: run.plan, scope, minutes: run.minutes }).catch(() => ({ exitCode: 2 }));
  if (review.exitCode === 1) return { warnings, failed: true, evidence: review.findings };
  return { warnings, review: review.exitCode === 0 ? `reviewed${review.partial ? ' (large diff, partly)' : ''}` : 'review unavailable' };
}

function checkStop(run) {
  if (run.stopRequested || !existsSync(stopFile(run.cwd))) return;
  rmSync(stopFile(run.cwd), { force: true });
  run.stopRequested = true;
  run.stop = stoppedNote;
  stopRunning();
  run.wake?.();
}

async function waitForProvider(run) {
  const schedule = run.config.run.limitWaitMinutes;
  if (run.limitWaits >= schedule.length) return false;
  const minutes = schedule[run.limitWaits++];
  run.current = `provider limit: waiting ${minutes} min`;
  save(run);
  if (run.limitWaits === 1) await notifyRun(run.cwd, 'paused', `Provider limit. Waiting ${minutes} min, then retrying.`);
  if (run.stopRequested) return false;
  await new Promise(done => {
    const timer = setTimeout(done, minutes * 60000);
    run.wake = () => { clearTimeout(timer); done(); };
  });
  return !run.stopRequested;
}

function reportLine(report) {
  return report.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^(?:DONE\b|#)/.test(line)).slice(0, 2).join(' ').slice(0, 300);
}

async function carryTask(run, task) {
  const plan = readPlan(run.cwd, run.plan, run.config);
  if (!task.accept.length) { settle(run, task, 'unverified', { note: 'no Accept commands; left unticked' }); return; }
  let evidence = '', last;
  let executor = task.executor ?? run.builderRole;
  const fallback = run.config.roles.fallback;
  const fallbackBuilder = fallback ? resolveBuilder(run.config, fallback) : null;
  let idleRetried = false;
  for (let number = 1; number <= 2; number++) {
    if (number === 2 && fallbackBuilder?.cmd) executor = fallback;
    const builder = resolveBuilder(run.config, executor);
    run.tasks[task.id] = { executor };
    run.current = `${task.id} ${task.title} (attempt ${number})`;
    run.currentSince = new Date().toISOString();
    save(run);
    const dir = join(run.dir, `${task.id}-${number}-${Date.now()}`);
    const prompt = workerPrompt(taskCard(run, plan, task, evidence), builder, run.root, run.cwd, run.config);
    const before = snapshotPlan(run);
    last = await attempt({ builder, prompt, commands: task.accept, cwd: run.cwd, dir, minutes: run.minutes, onPid: pid => { run.executorPid = pid; save(run); } });
    atomicWrite(join(dir, 'executor.txt'), `${executor}
`);
    guardPlan(run, before, `During ${task.id}, the worker`);
    if (last.treeUnconfirmed) {
      run.executorPid = last.pid;
      run.stop = `${task.id} timed out and its process tree may still be alive (pid ${last.pid}).`;
      settle(run, task, 'stopped', { note: run.stop });
      return;
    }
    const strayed = await returnToBranch(run, task);
    if (strayed) {
      run.planNotes.push(`During ${task.id}, ${strayed}.`);
      last = { ...last, status: 'failed', limited: false, idleTimedOut: false, note: strayed, evidence: strayed };
    }
    if (run.stop) { settle(run, task, 'stopped', { note: run.stop, ...(run.stopRequested ? { parked: await parkWork(run, task) } : {}) }); return; }
    if (last.limited) {
      number--;
      if (fallbackBuilder?.cmd && executor !== fallback) {
        run.note = `Provider limit on ${executor} during ${task.id}; switched to ${fallback} for the rest of the run.`;
        run.planNotes.push(run.note);
        executor = run.builderRole = fallback;
        run.builder = fallbackBuilder;
        idleRetried = false;
        save(run);
        continue;
      }
      if (await waitForProvider(run)) continue;
      if (run.stopRequested) { settle(run, task, 'stopped', { note: run.stop, parked: await parkWork(run, task) }); return; }
      run.stop = 'The provider limit did not clear. Run ff run --all when quota returns.';
      settle(run, task, 'waiting', { note: last.note });
      return;
    }
    run.limitWaits = 0;
    if (last.idleTimedOut && !idleRetried) {
      idleRetried = true;
      evidence = `${last.note}\n${last.evidence ?? ''}`.trim().slice(-12000);
      number--;
      continue;
    }
    idleRetried = false;
    if (last.status === 'blocked') {
      settle(run, task, 'held', { note: last.note, parked: await parkWork(run, task) });
      return;
    }
    if (last.status === 'passed') {
      const check = await checkChange(run, plan, task);
      if (run.stopRequested) { settle(run, task, 'stopped', { note: run.stop, parked: await parkWork(run, task) }); return; }
      if (check.failed) last = { ...last, note: 'review found blocking issues', evidence: check.evidence };
      else {
        setBox(run.cwd, run.plan, task.id, true);
        const commit = run.repo ? await commitAll(run.cwd, `ff: ${task.id} ${task.title}`) : { ok: true };
        if (commit.ok) {
          run.good = commit.head ?? run.good;
          settle(run, task, 'done', { commit: commit.head?.slice(0, 8), review: check.review, warnings: check.warnings, report: reportLine(last.report), attempts: number });
          return;
        }
        setBox(run.cwd, run.plan, task.id, false);
        last = { ...last, note: 'commit failed', evidence: commit.error };
      }
    }
    evidence = `${last.note ?? ''}\n${last.evidence ?? ''}`.trim().slice(-12000);
  }
  settle(run, task, 'failed', { note: last.note, parked: await parkWork(run, task) });
  await replan(run, task, evidence);
}

// Keeps the lead's plan edits and drops anything else it touched.
async function keepPlanEdits(run, task) {
  const kept = await commitPaths(run.cwd, `ff: lead replanned after ${task.id}`, [run.plan, 'DECISIONS.md']);
  if (!kept.ok) { run.stop = `The lead's plan edits after ${task.id} could not be committed; the worktree was left as it is. ${kept.error}`; return; }
  run.good = kept.head;
  await resetTo(run, run.good);
  await git(run.cwd, ['clean', '-fdq'], { timeoutMs: 120000 });
}

function leadCard(run, task, evidence, reportFile) {
  return [
    `# Lead review of stuck task ${task.id}`,
    `Task ${task.id} in ${run.plan} failed twice in an unattended run. Its work is parked on a branch and the tree is clean. Nobody will answer.`,
    `Why it failed:\n${evidence}`,
    `Decide what a good engineer would do next, and edit only ${run.plan} and DECISIONS.md:`,
    '- If the task is too big or its premise is wrong, narrow it or split it into new tasks with new IDs. Each keeps an Accept command that proves its outcome. Delete a task you replace.',
    '- The cause may be a different task or the plan itself. Fix what is actually wrong.',
    '- If it cannot move without a person, change nothing and say why.',
    'Never change the "Exit condition" line. Never loosen acceptance just to pass; if an outcome really changes, record that in DECISIONS.md. The tool reports every change you make.',
    `Write what you decided and why to ${reportFile}.`,
    '',
    run.rules,
  ].join('\n');
}

// A clean process looks at a stuck task with fresh eyes and may reshape the plan.
async function replan(run, task, evidence) {
  if (run.stop || run.leadRuns >= maxLeadRuns || run.leads.has(task.id)) return;
  run.leadRuns++;
  run.leads.add(task.id);
  run.current = `lead reviewing ${task.id}`;
  save(run);
  const before = snapshotPlan(run);
  const dir = join(run.dir, `lead-${task.id}`), reportFile = join(dir, 'report.md');
  const card = leadCard(run, task, evidence, reportFile);
  atomicWrite(join(dir, 'prompt.md'), card);
  const { command, args } = invocation(run.builder);
  if (run.builder.promptFile) args.push(...promptFileArgs(run.cwd, join(dir, 'prompt.md')));
  const lead = await runProcess(command, args, {
    cwd: run.cwd, input: run.builder.promptFile ? undefined : card, timeoutMs: run.minutes * 60000, idleMs: run.builder.idleMinutes * 60000, env: { ...process.env, FF_RESULT_FILE: reportFile },
    onSpawn: pid => { run.executorPid = pid; save(run); },
  });
  if (!lead.timedOut || lead.killedTree === true) {
    run.executorPid = undefined;
    save(run);
  }
  atomicWrite(join(dir, 'output.txt'), `${lead.stdout}\n${lead.stderr}`);
  if (lead.timedOut && lead.killedTree !== true) {
    run.stop = `The lead reviewing ${task.id} timed out and may still be alive (pid ${lead.pid}).`;
    return;
  }
  const { edited, changes } = guardPlan(run, before, `After ${task.id}, the lead`);
  await returnToBranch(run, task);
  if (run.repo && run.stopRequested) {
    const parked = await parkWork(run, task);
    if (parked) run.tasks[task.id].parked = [run.tasks[task.id].parked, parked].filter(Boolean).join(', ');
  }
  else if (run.repo && !run.stop) await keepPlanEdits(run, task);
  const said = reportLine(read(reportFile)) || 'no report';
  run.planNotes.push(`After ${task.id}, the lead reported: ${said} Details: ${join('.ff/runs', run.id, `lead-${task.id}`)}.`);
  if (edited) for (const id of [task.id, ...changes.changed, ...changes.added]) run.settled.delete(id);
  run.current = '';
  save(run);
}

function nextTask(plan, run) {
  return plan.tasks.find(task => !task.done && !run.settled.has(task.id) && !holdOn(plan, task)
    && task.depends.every(id => plan.tasks.find(other => other.id === id)?.done));
}

function finalState(plan, run, task) {
  if (task.done) return { ...run.tasks[task.id], status: 'done' };
  const hold = holdOn(plan, task);
  if (hold) return { status: 'held', note: hold.reason };
  if (run.tasks[task.id]) return run.tasks[task.id];
  const waiting = task.depends.filter(id => !plan.tasks.find(other => other.id === id)?.done);
  return waiting.length ? { status: 'blocked', note: `by ${waiting.join(', ')}` } : { status: 'not started' };
}

async function checkExit(run, plan) {
  if (!plan.exit) return 'none set';
  if (!plan.exitCommand) return 'needs an observer';
  const shell = shellCommand(plan.exitCommand);
  const result = await runProcess(shell.command, shell.args, { cwd: run.cwd, timeoutMs: run.minutes * 60000 });
  atomicWrite(join(run.dir, 'exit-condition.txt'), `${result.stdout}\n${result.stderr}`);
  return result.exitCode === 0 && !result.timedOut && !result.error ? 'passed' : 'failed';
}

async function finish(run) {
  const plan = readPlan(run.cwd, run.plan, run.config);
  const states = plan.tasks.map(task => ({ task, state: finalState(plan, run, task) }));
  const allDone = states.every(({ state }) => state.status === 'done');
  const exit = run.stop ? 'not checked' : await checkExit(run, plan);
  if (run.stopRequested && unstopped.length) {
    run.executorPid = unstopped[0];
    run.stop = `Could not confirm that pid ${unstopped.join(', ')} ended. Check before starting another run.`;
  }
  const finished = states.length > 0 && allDone && !run.stop && exit !== 'failed' && !plan.notes.length;
  const complete = finished && !run.criteriaChanged;
  const status = complete ? 'complete' : finished ? 'needs review' : run.stop ? 'stopped' : 'incomplete';
  const row = ({ task, state }) => {
    const facts = [state.commit, state.attempts > 1 ? `${state.attempts} attempts` : '', state.review, ...(state.warnings ?? []), state.note, state.parked ? `work kept on ${state.parked}` : '', state.executor ? `executor: ${state.executor}` : ''].filter(Boolean);
    return `- ${task.id} ${task.title}: ${state.status}${facts.length ? ` — ${facts.join('; ')}` : ''}${state.report ? `\n  ${state.report}` : ''}`;
  };
  const decisions = decisionLines(run.cwd);
  const summary = [
    `# ${plan.goal || run.plan}`,
    `Status: ${status}. Exit condition: ${exit}.${run.branch ? ` Branch: ${run.branch}.` : ''}`,
    finished && !complete ? 'Every task passed, but acceptance or the task list changed during the run. Read the plan changes before trusting this.' : '',
    run.stop ?? '',
    states.map(row).join('\n'),
    run.planNotes.length ? `## Plan changes\n${run.planNotes.map(note => `- ${note}`).join('\n')}` : '',
    plan.notes.length ? `## Plan notes\n${plan.notes.map(note => `- ${note}`).join('\n')}` : '',
    decisions.length ? `## To confirm\n${decisions.join('\n')}` : '',
    `## Next\n${finished ? 'Read the commits on the branch. They skipped git hooks, so run your checks before closing through the normal flow.' : 'Fix or edit the plan, then run ff run --all again. Done tasks are skipped and failed tasks get a fresh try.'} Nothing went live.`,
  ].filter(Boolean).join('\n\n');
  atomicWrite(join(run.dir, 'summary.md'), `${summary}\n`);
  console.log(summary);
  run.status = complete ? 'done' : status;
  run.note = `Exit condition: ${exit}`;
  run.current = '';
  save(run);
  const counts = `${states.filter(({ state }) => state.status === 'done').length} of ${states.length} tasks done.`;
  await notifyRun(run.cwd, complete ? 'done' : run.stopRequested ? 'paused' : 'failed', [`${plan.goal || run.plan}: ${status}. ${counts}`, run.stop].filter(Boolean).join('\n'));
  return complete ? 0 : 1;
}

// A controller that died left a process's plan edits unchecked. The snapshot from before that process settles them.
function recoverPlan(run, dead) {
  const snapshot = read(join(run.cwd, '.ff/runs', dead.id, 'plan-before.md'));
  if (snapshot) guardPlan(run, parsePlan(snapshot, run.config), 'Before the last run died, a process');
}

async function openWorktree(run, interrupted) {
  if (interrupted) recoverPlan(run, interrupted);
  await excludeGitEntries(run.cwd, runExcludes);
  run.repo = (await git(run.cwd, ['rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true';
  if (!run.repo) { console.error('Warning: not a git repository; tasks cannot be isolated or committed.'); return true; }
  const identity = await git(run.cwd, ['var', 'GIT_COMMITTER_IDENT']);
  if (identity.exitCode !== 0) { console.error('Cannot run: git has no user.name and user.email here, so work could not be saved.'); return false; }
  run.branch = await startRunBranch(run.cwd, run.id);
  if (!run.branch) { console.error('Cannot run: the run branch could not be created, and unattended work never lands on the main branch.'); return false; }
  const start = await commitAll(run.cwd, 'ff: checkpoint before run');
  if (!start.ok || !start.head) { console.error(`Cannot checkpoint the worktree: ${start.error ?? 'the repository has no commit to return to'}`); return false; }
  run.good = start.head;
  return true;
}

export async function runAll(args, root, cwd = process.cwd()) {
  const options = parseArgs(args);
  const { config } = readConfig(cwd);
  const plan = readPlan(cwd, options.plan, config);
  if (!plan.tasks.length) { console.error([`No tasks found in ${options.plan}. Expected "- [ ] T1 <outcome>" under "## Tasks".`, ...plan.notes].join('\n')); return 1; }
  if (options.dryRun) {
    console.log(`Dry run: ${options.plan} (current plan; no processes or writes)`);
    for (const note of plan.notes) console.error(`Note: ${note}`);
    for (const task of plan.tasks) {
      const { status, note } = finalState(plan, { tasks: {} }, task);
      console.log(`- ${task.id} ${task.title}: ${status === 'not started' ? 'would run' : status}${note ? ` — ${note}` : ''}`);
    }
    return 0;
  }
  const builder = resolveBuilder(config);
  if (!builder.cmd) {
    console.error(`${builder.note}\nUnattended runs need a headless builder: set roles.builder to claude, codex, or pi:<vendor>/<model>:<effort> in ~/.ff/config.json. Or work through the plan in this session.`);
    return 1;
  }
  if (!options.foreground) return detach(args, cwd, newId());
  const id = options.id || newId();
  let watcher;
  const lock = acquireLock(join(cwd, '.ff/run.lock'), options.force);
  if (!lock.ok) { console.error(`Worktree busy: ${lock.reason} (pid ${lock.pid ?? 'unknown'}). Use ff status; --force overrides.`); return 1; }
  try {
    const last = latestRun(cwd);
    if (!options.force && (runIsLive(last) || executorIsLive(last))) {
      console.error(`Run ${last.id} still has a live process (pid ${last.executorPid ?? last.pid}). Stop it, or use --force.`);
      return 1;
    }
    const run = {
      id, dir: join(cwd, '.ff/runs', id), cwd, root, config, builder, builderRole: config.roles.builder, plan: options.plan, minutes: options.minutes,
      pid: process.pid, startedAt: new Date().toISOString(), status: 'running', current: '', tasks: {},
      settled: new Set(), leads: new Set(), leadRuns: 0, planNotes: [], parks: 0, limitWaits: 0, rules: playbookRules(root),
    };
    for (const note of plan.notes) console.error(`Note: ${note}`);
    if (!await openWorktree(run, last?.kind === 'plan' && last.status === 'running' && last.plan === run.plan ? last : null)) {
      await notifyRun(cwd, 'failed', `${options.plan}: the run could not start.`);
      return 1;
    }
    save(run);
    rmSync(stopFile(cwd), { force: true });
    watcher = setInterval(() => checkStop(run), 1000);
    for (let task = nextTask(readPlan(cwd, run.plan, run.config), run); task && !run.stop; task = nextTask(readPlan(cwd, run.plan, run.config), run)) {
      try { await carryTask(run, task); }
      catch (error) {
        run.stop ??= `${task.id}: ${error.message}`;
        if (!run.tasks[task.id]?.status) settle(run, task, 'stopped', { note: run.stop });
      }
    }
    return await finish(run);
  } finally {
    clearInterval(watcher);
    releaseLock(lock);
  }
}
