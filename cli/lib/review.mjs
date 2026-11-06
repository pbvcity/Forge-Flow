import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readConfig, resolveBuilder } from './config.mjs';
import { runProcess, commandTemplate } from './proc.mjs';
import { atomicWrite } from './fsx.mjs';
import { excludeGitEntries } from './git.mjs';
import { diffLimit, diffOptions, readDiff, boundedDiff } from './diff.mjs';

const sensitiveKey = /(?:api[_-]?key|token|password|secret|authorization|credential|access[_-]?key)/i;
export function redactSecrets(text) {
  let result = String(text)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/g, '<redacted>')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '<redacted>')
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, '<redacted private key>')
    .replace(/((?:["']?[\w-]*(?:api[_-]?key|token|password|secret|authorization)["']?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, '$1"<redacted>"')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1<redacted>@')
    .replace(/(--[\w-]*(?:token|password|secret|api-key|api_key)\s+)("[^"\n]*"|'[^'\n]*'|[^\s]+)/gi, '$1<redacted>');
  for (const [key, value] of Object.entries(process.env)) {
    if (sensitiveKey.test(key) && value && value.length >= 8) result = result.replaceAll(value, '<redacted>');
  }
  return result;
}

const blocking = /^[\s#*\-\d.)[|]*(?:BLOCKER|HIGH)\b|\|\s*\*{0,2}(?:BLOCKER|HIGH)\*{0,2}\s*\|/m;
const noneReported = /^\s*(?:\*\*)?(?:BLOCKER|HIGH)(?:\*\*)?\s*[:=]?\s*(?:\*\*)?\s*(?:0|none)(?:\*\*)?\.?\s*$/gim;

// The verdict is the reviewer's. The tool only refuses to call a contradiction a pass.
export function parseReview(text) {
  const warnings = [];
  const last = [...text.matchAll(/^[ \t]*(?:\*\*)?VERDICT(?:\*\*)?[ \t]*:[ \t]*(?:\*\*)?[ \t]*([A-Za-z]*)/gim)].at(-1)?.[1].toUpperCase();
  let verdict = ['PASS', 'FAIL'].includes(last) ? last : 'unknown';
  if (verdict === 'PASS' && blocking.test(text.replace(noneReported, ''))) {
    verdict = 'FAIL';
    warnings.push('PASS alongside a BLOCKER or HIGH line; counted as FAIL');
  }
  return { verdict, warnings };
}

function optionalFile(path) {
  try { return readFileSync(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') console.error(`Warning: ${path}: ${error.message}`); return ''; }
}
function boundedContext(text, limit = 24 * 1024) {
  if (Buffer.byteLength(text) <= limit) return text;
  return `${Buffer.from(text).subarray(0, limit - 100).toString('utf8')}\n[OMITTED: context beyond ${limit} bytes]`;
}

export function resolveReviewer(config, member) {
  if (!member || member === 'host') return { note: 'Use a clean read-only host sub-agent for this reviewer.' };
  const resolved = resolveBuilder({ ...config, roles: { ...config.roles, builder: member } });
  if (!resolved.cmd) return { note: `No executor configured for reviewer ${member}` };
  const template = Array.isArray(resolved.cmd) ? { command: resolved.cmd[0], args: resolved.cmd.slice(1) } : commandTemplate(resolved.cmd);
  let extra;
  if (member.startsWith('pi:')) extra = ['--tools', 'read,grep,find,ls'];
  else if (resolved.reviewArgs !== undefined) {
    if (Array.isArray(resolved.reviewArgs)) extra = resolved.reviewArgs;
    else {
      const parsed = commandTemplate(String(resolved.reviewArgs));
      extra = parsed.command ? [parsed.command, ...parsed.args] : [];
    }
  }
  else if (/^codex(?:\.(?:cmd|exe|bat))?$/i.test(basename(template.command))) {
    template.args = removeArgs(template.args, ['--sandbox', '-s'], ['--full-auto', '--dangerously-bypass-approvals-and-sandbox']);
    extra = ['--sandbox', 'read-only'];
  }
  else if (/^claude(?:\.(?:cmd|exe|bat))?$/i.test(basename(template.command))) {
    template.args = removeArgs(template.args, ['--permission-mode'], ['--dangerously-skip-permissions']);
    extra = ['--tools', 'Read,Grep,Glob', '--permission-mode', 'plan'];
  }
  else {
    extra = [];
    console.error(`Warning: custom reviewer ${member}: cmd must enforce read-only mode, or supply reviewArgs; ff cannot sandbox arbitrary executables.`);
  }
  const argv = [...template.args, ...extra];
  let model;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model' || argv[i] === '-m') model = argv[++i];
    else if (typeof argv[i] === 'string' && argv[i].startsWith('--model=')) model = argv[i].slice(8);
  }
  return { command: template.command, args: argv, model: member.startsWith('pi:') ? member.slice(3) : model ?? 'unspecified (executor default)' };
}

function removeArgs(args, pairs, flags) {
  return args.filter((arg, index) => !flags.includes(arg) && !pairs.includes(arg) && !pairs.includes(args[index - 1]) && !pairs.some(flag => arg.startsWith(`${flag}=`)));
}

function reviewPrompt({ root, cwd, base, plan: planPath = 'PLAN.md', scope, round, diff }) {
  const discipline = readFileSync(join(root, 'playbook/review.md'), 'utf8');
  const plan = optionalFile(join(cwd, planPath));
  // The plan is the default acceptance file; an explicit markdown link can name a separate one.
  let acceptance = scope ?? plan;
  if (!scope) for (const link of plan.matchAll(/\[[^\]]*(?:acceptance|criteria)[^\]]*\]\(([^)]+)\)/gi)) {
    if (!/^(?:[a-z]+:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/i.test(link[1])) acceptance += `\n${optionalFile(join(cwd, link[1]))}`;
  }
  const known = optionalFile(join(cwd, 'REVIEW.md'));
  const accepted = [...known.matchAll(/^#{1,6}\s+Known accepted[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/gim)].map(match => match[1]).join('\n');
  const [rules, tail] = discipline.split('## Reviewer prompt');
  const instructions = tail
    .replace('<path to this file>', join(root, 'playbook/review.md'))
    .replace('Known accepted, do not raise: <path>', 'Known accepted, do not raise: REVIEW.md excerpts above')
    .replace('<diff or range>', 'diff above')
    .replace('Acceptance criteria: <path>', `Acceptance criteria: ${planPath} and linked criteria above`);
  const sections = [
    'Read-only review. Do not modify files or run write commands.',
    `Range: ${base} to current worktree (including non-ignored untracked files); round ${round}.${round > 1 ? ' Fix diff only: --base must identify the pre-fix revision.' : ''}`,
    `Acceptance criteria (${planPath}):\n${boundedContext(acceptance || '(no plan)')}`,
    `Known accepted (REVIEW.md):\n${boundedContext(accepted || '(none)')}`,
    `Review discipline:\n${rules}`,
    `Diff:\n${boundedDiff(diff)}`,
    instructions,
  ];
  return redactSecrets(sections.join('\n\n'));
}

function reviewers(config, risk, round, wantPanel) {
  const panel = (Array.isArray(config.review.panel) ? config.review.panel : []).filter(item => typeof item === 'string' && item.trim());
  const contractTier = ['contract', 'high'].includes(risk);
  if (round === 1 && panel.length && (wantPanel || contractTier)) return panel;
  if (risk === 'micro' && !wantPanel) return [];
  const lead = config.roles.reviewer || 'host';
  return round === 1 && contractTier && config.roles.second ? [lead, config.roles.second] : [lead];
}

async function runReviewer(config, member, prompt, cwd, minutes) {
  const base = { member, model: String(member), status: 'absent', durationMs: 0, verdict: 'unknown', warnings: [] };
  const executor = resolveReviewer(config, member);
  if (executor.note) return { row: { ...base, note: executor.note }, stdout: `${executor.note}\n`, stderr: '' };
  const result = await runProcess(executor.command, executor.args, { cwd, input: prompt, timeoutMs: minutes * 60000 });
  const parsed = parseReview(result.stdout);
  const status = result.timedOut ? 'timeout' : result.error || result.exitCode !== 0 || result.signal ? 'failed' : 'completed';
  const warnings = [...parsed.warnings, ...(result.outputTruncated ? ['Output truncated: last 4 MiB per stream retained'] : [])];
  const verdict = parsed.verdict === 'PASS' && (status !== 'completed' || result.outputTruncated) ? 'unknown' : parsed.verdict;
  return { row: { ...base, verdict, warnings, model: executor.model, command: [executor.command, ...executor.args], status, durationMs: result.durationMs, exitCode: result.exitCode, pid: result.pid, error: result.error }, stdout: result.stdout, stderr: result.stderr };
}

export async function reviewChange({ root, cwd, config, base, risk, round = 1, panel = false, plan, scope, minutes = 60 }) {
  const members = reviewers(config, risk, round, panel);
  if (!members.length) return { exitCode: 0, rows: [], skipped: 'micro: no reviewers; check your own diff.' };
  if (members.every(member => member === 'host')) return { exitCode: 3, rows: [], skipped: 'Use a clean read-only host sub-agent for this review.' };
  await excludeGitEntries(cwd, ['**/.ff/reviews/']);
  const diff = await readDiff(cwd, base);
  const prompt = reviewPrompt({ root, cwd, base, plan, scope, round, diff });
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = join(cwd, '.ff/reviews', id);
  const results = await Promise.all(members.map(member => runReviewer(config, member, prompt, cwd, minutes).catch(error => ({ row: { member, model: String(member), status: 'failed', durationMs: 0, verdict: 'unknown', warnings: [], note: error.message }, stdout: `${error.message}\n`, stderr: '' }))));
  // Publish only after every process exits: running peers cannot read this panel's results.
  results.forEach((result, index) => {
    const name = `${index + 1}-${String(result.row.member).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70)}`;
    result.row.output = `${name}.md`;
    atomicWrite(join(dir, result.row.output), redactSecrets(result.stdout));
    atomicWrite(join(dir, `${name}.stderr.txt`), redactSecrets(result.stderr));
  });
  const rows = results.map(result => result.row);
  const exitCode = rows.some(row => row.verdict === 'FAIL') ? 1 : rows.some(row => row.verdict === 'PASS' && row.status === 'completed') ? 0 : 2;
  const partial = Buffer.byteLength(diff) > diffLimit;
  atomicWrite(join(dir, 'summary.json'), redactSecrets(`${JSON.stringify({ id, base, risk, round, exitCode, partial, members: rows }, null, 2)}\n`));
  const findings = results.filter(result => result.row.verdict === 'FAIL').map(result => result.stdout).join('\n\n').slice(-12000);
  return { exitCode, rows, dir, partial, findings };
}

export async function review(args, root, cwd = process.cwd()) {
  const options = diffOptions(args, true);
  const { config } = readConfig(cwd);
  if (options.round === 1 && ['contract', 'high'].includes(options.risk) && !config.roles.second && !config.review.panel?.length) console.error('Note: no second family configured; one reviewer only.');
  let result;
  try { result = await reviewChange({ root, cwd, config, ...options }); }
  catch (error) { console.error(`Review unavailable: ${error.message}`); return 2; }
  if (result.skipped) { (result.exitCode ? console.error : console.log)(result.skipped); return result.exitCode; }
  console.log('Reviewer | Model | Status | Verdict | Duration');
  for (const row of result.rows) console.log(redactSecrets(`${row.member} | ${row.model} | ${row.status} | ${row.verdict} | ${row.durationMs}ms${row.note ? ` | ${row.note}` : ''}${row.warnings.length ? ` | ${row.warnings.join('; ')}` : ''}`));
  if (result.partial) console.log(`Large diff: reviewers saw only the first part. Split the change or review the rest by hand.`);
  console.log(join(result.dir, 'summary.json'));
  return result.exitCode;
}
