import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promptFileArgs, readConfig, resolveBuilder } from './config.mjs';
import { acquireLock, releaseLock, atomicWrite, read, jsonFile } from './fsx.mjs';
import { isAlive, runProcess, shellCommand, commandTemplate } from './proc.mjs';
import { excludeGitEntries } from './git.mjs';
import { readPlan, holdOn } from './plan.mjs';
import { dueFollowupLines } from './followups.mjs';
import { planPath, planningFile } from './paths.mjs';
import { laneRecord } from './lanes.mjs';

export const runExcludes = ['**/.ff/runs/', '**/.ff/run.lock', '**/.ff/reviews/', '**/.ff/stop-request'];
export const newId = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;

const providerLimit = /\b429\b|rate.?limit|quota|usage limit|limit reached|too many requests|overloaded|at capacity|insufficient (?:balance|credit)/i;

export function acceptanceCommands(card) {
  const result = [];
  let inAccept = false;
  for (const line of card.split(/\r?\n/)) {
    const match = line.match(/^Accept:\s*(.*)$/i);
    if (match) { inAccept = true; if (match[1]) result.push(match[1]); continue; }
    if (!inAccept) continue;
    if (!line.trim() || /^#/.test(line)) { inAccept = false; continue; }
    if (/^```/.test(line)) continue;
    result.push(line.replace(/^[-*]\s+/, '').trim());
  }
  return result;
}

export function latestRun(cwd) {
  let names;
  try { names = readdirSync(join(cwd, '.ff/runs')); } catch { return null; }
  for (const name of names.sort().reverse()) {
    const run = jsonFile(join(cwd, '.ff/runs', name, 'run.json'));
    if (run) return run;
  }
  return null;
}

export const runIsLive = run => run?.status === 'running' && isAlive(run.pid) !== false;
export const executorIsLive = run => Boolean(run?.executorPid) && isAlive(run.executorPid) === true;

export function openDecisions(cwd, config = readConfig(cwd, undefined, () => {}).config) {
  return read(planningFile(cwd, config, 'DECISIONS.md')).split(/\r?\n/).flatMap(line => line.match(/^\s*-\s+\[ \]\s+(.+)/)?.[1].trim() ?? []);
}

export function decisionLines(cwd) {
  const open = openDecisions(cwd);
  if (!open.length) return [];
  return [`Business decisions: ${open.length} open — confirm these before going live.`, ...open.map(item => `- [ ] ${item}`)];
}

function elapsed(since) {
  const minutes = Math.floor((Date.now() - Date.parse(since)) / 60000);
  return minutes < 1 ? 'under a minute' : `${minutes} min`;
}

export function status(cwd = process.cwd(), args = []) {
  let explicit;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--plan') throw new Error(`Unknown status option: ${args[i]}`);
    explicit = args[++i];
    if (!explicit || explicit.startsWith('--')) throw new Error('--plan needs a path');
  }
  for (const line of dueFollowupLines(cwd)) console.log(line);
  const run = latestRun(cwd);
  const interrupted = run?.status === 'running' && isAlive(run.pid) === false;
  const live = run?.status === 'running' && !interrupted;
  const { config } = readConfig(cwd, undefined, () => {});
  let plan;
  try { plan = readPlan(cwd, planPath(cwd, config, explicit ?? run?.plan), config); } catch {}
  if (!run) console.log('No runs recorded.');
  else {
    const resume = run.lanes?.length ? `ff run --all --lanes ${run.lanes.length} resumes it` : 'ff run --all resumes it';
    console.log(`Latest run: ${interrupted ? `interrupted; ${resume}` : run.status}, started ${elapsed(run.startedAt)} ago${run.branch ? `, branch ${run.branch}` : ''}`);
    if (live && run.current) console.log(`Now: ${run.current}, for ${elapsed(run.currentSince ?? run.startedAt)}`);
    if (run.note) console.log(run.note);
    for (const lane of run.lanes ?? []) {
      const child = lane.path ? laneRecord(lane) : null;
      console.log(`Lane ${lane.letter}: ${lane.tasks.join(', ')} — ${child?.status || lane.status}${child?.current ? ` (${child.current})` : ''}; ${lane.path ?? 'pending'}${lane.merged ? '; merged' : ''}`);
    }
  }
  const inLane = {};
  for (const lane of run?.lanes ?? []) if (lane.path && !lane.merged) {
    const child = laneRecord(lane);
    for (const id of lane.tasks) {
      const saved = child?.tasks?.[id];
      inLane[id] = child?.current?.startsWith(`${id} `) ? { state: `running in lane ${lane.letter}` }
        : saved ? { state: saved.status === 'done' ? `done in lane ${lane.letter}, not merged yet` : saved.status, note: saved.note }
        : { state: `queued in lane ${lane.letter}` };
    }
  }
  const states = (plan?.tasks ?? []).map(task => {
    const saved = run?.tasks?.[task.id], hold = holdOn(plan, task);
    if (task.done) return { task, state: 'done' };
    if (inLane[task.id]) return { task, ...inLane[task.id] };
    if (live && run.current?.startsWith(`${task.id} `)) return { task, state: 'running' };
    if (hold) return { task, state: 'held', note: hold.reason };
    if (saved) return { task, state: saved.status, note: saved.note };
    return { task, state: task.depends.some(id => !plan.tasks.find(other => other.id === id)?.done) ? 'blocked' : 'not started' };
  });
  const counts = [...new Set(states.map(item => item.state))].map(state => `${states.filter(item => item.state === state).length} ${state}`);
  if (counts.length) console.log(`Tasks: ${counts.join(', ')}`);
  for (const { task, state, note } of states.filter(item => item.state !== 'done')) console.log(`${task.id}: ${state} — ${task.title}${note ? ` — ${note}` : ''}`);
  for (const note of plan?.notes ?? []) console.log(note);
  if (run?.kind === 'plan' && existsSync(join(cwd, '.ff/runs', run.id, 'summary.md'))) console.log(`Report: ${join('.ff/runs', run.id, 'summary.md')}`);
  for (const line of decisionLines(cwd)) console.log(line);
}

export function workerPrompt(card, builder, root, cwd, config) {
  const profile = ['generic', 'gpt', 'claude'].includes(builder.profile) ? builder.profile : 'generic';
  const own = read(resolve(cwd, config.playbook.replace(/^~(?=[/\\]|$)/, () => homedir())));
  const profileText = read(join(root, 'playbook/executors', `${profile}.md`))
    .replaceAll('`DECISIONS.md`', '`' + relative(cwd, planningFile(cwd, config, 'DECISIONS.md')) + '`');
  return [card, profileText, own].filter(Boolean).join('\n\n');
}

export const invocation = builder => Array.isArray(builder.cmd) ? { command: builder.cmd[0], args: builder.cmd.slice(1) } : commandTemplate(builder.cmd);

// One attempt: the executor works, then the tool runs acceptance itself.
export async function attempt({ builder, prompt, commands, cwd, dir, minutes, onPid = () => {} }) {
  const write = (name, text) => atomicWrite(join(dir, name), text);
  const reportFile = join(dir, 'report.md');
  // Some CLIs filter the environment, so the path travels in the prompt.
  const input = `${prompt}\n\nReport file: ${reportFile}`;
  write('prompt.md', input);
  const timeoutMs = minutes * 60000;
  const { command, args } = invocation(builder);
  if (builder.promptFile) args.push(...promptFileArgs(cwd, join(dir, 'prompt.md')));
  const worker = await runProcess(command, args, { cwd, input: builder.promptFile ? undefined : input, timeoutMs, idleMs: builder.idleMinutes * 60000, env: { ...process.env, FF_RESULT_FILE: reportFile }, onSpawn: onPid });
  if (!worker.timedOut || worker.killedTree === true) onPid(undefined);
  write('output.txt', worker.stdout);
  write('stderr.txt', worker.stderr);
  const report = read(reportFile);
  const result = { report, idleTimedOut: worker.idleTimedOut, acceptance: [], durationMs: worker.durationMs, treeUnconfirmed: worker.timedOut && worker.killedTree !== true, pid: worker.pid };
  const blocked = (report || worker.stdout).match(/^\s*BLOCKED:\s*(.+)$/im)?.[1];
  if (worker.exitCode !== 0 || worker.timedOut || worker.error) {
    const said = `${worker.stderr}\n${worker.stdout.slice(-8192)}`;
    const limited = !worker.timedOut && !blocked && providerLimit.test(`${worker.stderr.slice(-2048)}\n${worker.stdout.slice(-500)}`);
    return { ...result, status: blocked && !worker.idleTimedOut ? 'blocked' : 'failed', limited, note: worker.idleTimedOut ? worker.reason : blocked ?? worker.error ?? worker.reason ?? `executor exit ${worker.exitCode}`, evidence: said.slice(-6000) };
  }
  if (blocked) return { ...result, status: 'blocked', note: blocked };
  if (!commands.length) return { ...result, status: 'unverified', note: 'no Accept commands' };
  for (const text of commands) {
    const shell = shellCommand(text);
    const checked = await runProcess(shell.command, shell.args, { cwd, timeoutMs });
    const output = `${checked.stdout}\n${checked.stderr}`;
    write(`accept-${result.acceptance.length + 1}.txt`, output);
    result.acceptance.push({ command: text, passed: checked.exitCode === 0 && !checked.timedOut && !checked.error, exitCode: checked.exitCode, output: output.slice(-3000) });
    if (checked.timedOut && checked.killedTree !== true) { result.treeUnconfirmed = true; result.pid = checked.pid; break; }
  }
  const failed = result.acceptance.filter(item => !item.passed);
  if (!failed.length) return { ...result, status: 'passed' };
  return { ...result, status: 'failed', note: failed.map(item => `${item.command}: exit ${item.exitCode ?? '?'}`).join('; '), evidence: failed.map(item => `$ ${item.command}\n${item.output}`).join('\n') };
}

export async function runCard(args, root, cwd = process.cwd()) {
  const [file, ...flags] = args;
  if (!file || file.startsWith('--')) throw new Error('usage: ff run <card file> [--timeout-min <minutes>] [--force]');
  let minutes = 60, force = false;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--force') { force = true; continue; }
    if (flags[i] !== '--timeout-min') throw new Error(`Unknown run option: ${flags[i]}`);
    minutes = Number(flags[++i]);
  }
  if (!(minutes > 0 && Number.isFinite(minutes))) throw new Error('--timeout-min must be a positive number');
  const card = readFileSync(resolve(cwd, file), 'utf8');
  const { config } = readConfig(cwd);
  const builder = resolveBuilder(config);
  if (!builder.cmd) { console.error(builder.note); return 1; }
  const lock = acquireLock(join(cwd, '.ff/run.lock'), force);
  if (!lock.ok) { console.error(`Worktree busy: ${lock.reason} (pid ${lock.pid ?? 'unknown'}). Use ff status; --force overrides.`); return 1; }
  try {
    const last = latestRun(cwd);
    if (!force && executorIsLive(last)) { console.error(`An executor from the last run is still alive (pid ${last.executorPid}). Stop it, or use --force.`); return 1; }
    await excludeGitEntries(cwd, runExcludes);
    const id = newId(), dir = join(cwd, '.ff/runs', id), startedAt = new Date().toISOString();
    const title = card.split(/\r?\n/).find(line => line.startsWith('# '))?.slice(2) ?? file;
    const save = fields => atomicWrite(join(dir, 'run.json'), JSON.stringify({ id, kind: 'card', pid: process.pid, startedAt, ...fields }));
    save({ status: 'running', current: title });
    const result = await attempt({ builder, prompt: workerPrompt(card, builder, root, cwd, config), commands: acceptanceCommands(card), cwd, dir, minutes, onPid: pid => save({ status: 'running', current: title, executorPid: pid }) });
    const state = { passed: 'done', failed: 'failed', blocked: 'blocked', unverified: 'unverified' }[result.status];
    const note = `${title}: ${state}${result.note ? ` — ${result.note}` : ''}`;
    save({ status: state, note, acceptance: result.acceptance.map(({ command, exitCode, passed }) => ({ command, exitCode, passed })), ...(result.treeUnconfirmed ? { executorPid: result.pid } : {}) });
    console.log(`${id}: ${note} — ${dir}`);
    return ['passed', 'unverified'].includes(result.status) ? 0 : 1;
  } finally { releaseLock(lock); }
}
