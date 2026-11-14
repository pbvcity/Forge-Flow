import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { builtInExecutors, promptFileArgs, readConfig, resolveBuilder } from './config.mjs';
import { autoSyncAgents } from './agents.mjs';
import { runProcess, commandTemplate } from './proc.mjs';
import { atomicWrite } from './fsx.mjs';
import { excludeGitEntries } from './git.mjs';
import { collectChange, diffOptions, inventoryText } from './diff.mjs';
import { planPath } from './paths.mjs';
import { authFailure } from './failure.mjs';

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
  const last = [...text.matchAll(/^[ \t]*(?:\*\*)?VERDICT(?:\*\*)?[ \t]*:[ \t]*(?:\*\*)?[ \t]*([^\r\n]*)/gim)].at(-1)?.[1] ?? '';
  let verdict = /^(PASS|FAIL)(?:\s|\*\*|\.)*$/i.exec(last)?.[1].toUpperCase() ?? 'unknown';
  if (verdict !== 'FAIL' && ((/^PASS\b/i.test(last) && verdict !== 'PASS') || /\bconditional\b|有条件|条件通过/i.test(last))) {
    verdict = 'FAIL';
    warnings.push('conditional pass counted as FAIL');
  }
  if (verdict === 'PASS' && blocking.test(text.replace(noneReported, ''))) {
    verdict = 'FAIL';
    warnings.push('PASS alongside a BLOCKER or HIGH line; counted as FAIL');
  }
  const notRead = parseNotRead(text);
  return { verdict, warnings, ...(notRead ? { notRead } : {}) };
}

const listItem = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

// `Not read: all` and its equivalents: the member read none of the changed files.
export const isAllNotRead = items => items.length === 1 && /^(?:all|everything|\*|all(?: of)? (?:the )?(?:changed |listed )?(?:files|of them|changes)|every (?:changed )?file|the (?:whole|entire) (?:change|diff|patch))$/i.test(items[0]);

// The reviewer's own coverage note: the last `Not read:` line, inline or as a list below it. [] for none; undefined when not stated.
export function parseNotRead(text) {
  const lines = String(text).split(/\r?\n/);
  const label = /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*)?Not read[ \t]*(?::[ \t]*(?:\*\*)?|(?:\*\*)?[ \t]*:)/i;
  const index = lines.findLastIndex(line => label.test(line));
  if (index < 0) return undefined;
  const inline = lines[index].replace(label, '').trim();
  let items = [];
  if (inline) items = inline.split(/[,;]/);
  else {
    for (const line of lines.slice(index + 1)) {
      if (!line.trim() && !items.length) continue;
      if (!listItem.test(line)) break;
      items.push(line.replace(listItem, ''));
    }
  }
  items = items.map(item => item.replace(/[`*]/g, '').trim().replace(/[.。]$/, '').trim()).filter(Boolean);
  if (!items.length) return undefined;
  if (items.length === 1 && /^none$/i.test(items[0])) return [];
  return items.slice(0, 200);
}

function optionalFile(path) {
  try { return readFileSync(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') console.error(`Warning: ${path}: ${error.message}`); return ''; }
}
function boundedContext(text, limit = 24 * 1024) {
  if (Buffer.byteLength(text) <= limit) return text;
  return `${Buffer.from(text).subarray(0, limit - 100).toString('utf8')}\n[OMITTED: context beyond ${limit} bytes]`;
}

// `--restricted` stops Claude Code reading the user's settings, and the executor's own `--settings` is not passed through as is.
// What a reviewer needs to reach the same provider and account comes back through one generated settings file holding only these keys
// (names checked against Claude Code's settings schema); permissions, hooks, plugins, MCP, and status lines never do.
export const claudeSettingKeys = ['env', 'apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'proxyAuthHelper'];
const validModel = value => typeof value === 'string' && /^[\w.:/[\]-]{1,100}$/.test(value);
const validEffort = value => typeof value === 'string' && /^[a-z]{1,16}$/.test(value);

function pickSettings(source) {
  const picked = {};
  if (!source || typeof source !== 'object') return picked;
  if (source.env && typeof source.env === 'object' && !Array.isArray(source.env)) {
    picked.env = Object.fromEntries(Object.entries(source.env).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => [key, String(value)]));
  }
  for (const key of claudeSettingKeys.slice(1)) if (typeof source[key] === 'string') picked[key] = source[key];
  return picked;
}

// The user's settings.json, then each `--settings` the executor command gave (later wins; env merges per key).
// An executor `--settings` that cannot be read is an error: dropping it would silently send the review to another provider.
export function claudeReviewSettings({ executorSettings = [], cwd = process.cwd(), env = process.env, home = homedir() } = {}) {
  let user = {};
  try { user = JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json'), 'utf8')) ?? {}; } catch {}
  const sources = [user];
  for (const value of executorSettings) {
    try { sources.push(JSON.parse(value.trim().startsWith('{') ? value : readFileSync(resolve(cwd, value), 'utf8'))); }
    catch (error) { return { error: `cannot read the executor's --settings ${value.trim().startsWith('{') ? '(inline JSON)' : value}: ${error.message}` }; }
  }
  const settings = {};
  let model, effort;
  for (const source of sources) {
    const picked = pickSettings(source);
    if (picked.env) settings.env = { ...settings.env, ...picked.env };
    for (const key of claudeSettingKeys.slice(1)) if (picked[key] !== undefined) settings[key] = picked[key];
    if (validModel(source?.model)) model = source.model;
    if (validEffort(source?.effortLevel)) effort = source.effortLevel;
  }
  if (settings.env && !Object.keys(settings.env).length) delete settings.env;
  return { settings, model, effort };
}

// Kept from the executor's own command. Everything else is dropped: tool grants, permission modes, plugins, agents,
// MCP, setting sources, positionals, and anything after `--` (which would turn the read-only flags into prompt text).
const claudeKeepFlags = ['-p', '--print', '--verbose', '--no-session-persistence', '--include-partial-messages'];
const claudeKeepValues = ['--model', '--effort', '--fallback-model', '--output-format', '--input-format', '--append-system-prompt', '--max-budget-usd'];
export function claudeExecutorArgs(args) {
  const kept = [], settings = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === '--') break;
    const name = arg.startsWith('--') ? arg.split('=')[0] : arg;
    const attached = arg.startsWith('--') && arg.includes('=');
    if (claudeKeepFlags.includes(arg)) kept.push(arg);
    else if (name === '--settings') {
      if (attached) settings.push(arg.slice(arg.indexOf('=') + 1));
      else if (i + 1 < args.length) settings.push(String(args[++i]));
    } else if (claudeKeepValues.includes(name)) {
      if (attached) kept.push(arg);
      else if (i + 1 < args.length) kept.push(arg, String(args[++i]));
    }
  }
  return { kept, settings };
}

// Claude Code's built-in read-only command set runs without rules, dontAsk denies anything else,
// and --restricted keeps user and project settings (including allow rules and bypass modes) out.
export const claudeReviewArgs = ['--restricted', '--tools', 'Read,Grep,Glob,Bash', '--permission-mode', 'dontAsk', '--strict-mcp-config'];
// Claude Code without --restricted: file tools only, because user allow rules could otherwise open Bash.
export const claudeLegacyReviewArgs = ['--tools', 'Read,Grep,Glob', '--permission-mode', 'plan', '--setting-sources', 'user', '--strict-mcp-config'];
// Pi reviewers: no discovered extensions, file tools, and ff's read-only `git_read` tool, loaded from ff's own install.
export const piGitReadExtension = fileURLToPath(new URL('../pi/git-read.ts', import.meta.url));
export const piReviewArgs = ['--no-extensions', '-e', piGitReadExtension, '--tools', 'read,grep,find,ls,git_read'];
export const noRestrictedNote = 'claude has no --restricted; reviewed with read-only file tools only';
const restrictedUnsupported = stderr => /unknown option[^\n]*--restricted|--restricted[^\n]*(?:unknown|unrecognized|not recognized|invalid)/i.test(stderr);

export function resolveReviewer(config, member, { quiet = false, legacyClaude = false, cwd = process.cwd() } = {}) {
  if (!member || member === 'host') return { note: 'Use a clean read-only host sub-agent for this reviewer.' };
  const resolved = resolveBuilder({ ...config, executors: config.userExecutors ?? builtInExecutors }, member);
  if (!resolved.cmd) return { note: config.projectExecutors?.includes(member)
    ? `executor ${member} is defined in the project's .ff/config.json; reviewers only run executors from ~/.ff/config.json. Move it there to use it.`
    : `No executor configured for reviewer ${member}` };
  const template = Array.isArray(resolved.cmd) ? { command: resolved.cmd[0], args: resolved.cmd.slice(1) } : commandTemplate(resolved.cmd);
  let extra, restricted = false, claudeSettings;
  if (member.startsWith('opencode:')) extra = ['--agent', 'ff-review'];
  else if (member.startsWith('pi:')) extra = piReviewArgs;
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
    const { kept, settings: executorSettings } = claudeExecutorArgs(template.args);
    const choice = claudeReviewSettings({ executorSettings, cwd });
    if (choice.error) return { note: `${member}: ${choice.error}` };
    template.args = kept;
    const has = flag => kept.some(arg => arg === flag || arg.startsWith(`${flag}=`));
    const model = !has('--model') && choice.model ? ['--model', choice.model] : [];
    // Claude Code old enough to lack --restricted may lack --effort too.
    const effort = !legacyClaude && !has('--effort') && choice.effort ? ['--effort', choice.effort] : [];
    restricted = !legacyClaude;
    extra = [...(legacyClaude ? claudeLegacyReviewArgs : claudeReviewArgs), ...model, ...effort];
    if (Object.keys(choice.settings).length) claudeSettings = choice.settings;
  }
  else {
    extra = [];
    if (!quiet) console.error(`Warning: custom reviewer ${member}: cmd must enforce read-only mode, or supply reviewArgs; ff cannot sandbox arbitrary executables.`);
  }
  const argv = [...template.args, ...extra];
  let model;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model' || argv[i] === '-m') model = argv[++i];
    else if (typeof argv[i] === 'string' && argv[i].startsWith('--model=')) model = argv[i].slice(8);
  }
  const env = member.startsWith('opencode:') ? { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { 'ff-review': {
    description: 'Read-only Forge Flow reviewer', mode: 'primary',
    permission: { '*': 'deny', read: 'allow', grep: 'allow', glob: 'allow', list: 'allow' },
  } } }) } : undefined;
  return { command: template.command, args: argv, env, restricted, claudeSettings, promptFile: resolved.promptFile, idleMinutes: resolved.idleMinutes, model: member.startsWith('pi:') ? member.slice(3) : model ?? 'unspecified (executor default)' };
}

export function prepareReviewerPrompt(executor, prompt, cwd, promptPath) {
  if (!executor.promptFile) return prompt;
  atomicWrite(promptPath, prompt);
  executor.args.push(...promptFileArgs(cwd, promptPath));
}

export const missingOpencodeAgent = stderr => /agent "ff-review" not found\. Falling back to default agent/i.test(stderr);

function removeArgs(args, pairs, flags) {
  return args.filter((arg, index) => !flags.includes(arg) && !pairs.includes(arg) && !pairs.includes(args[index - 1]) && !pairs.some(flag => arg.startsWith(`${flag}=`)));
}

// Reviewers get a brief: an inventory and where to read. The diff itself stays in the patch file.
function changeBrief({ patchPath, lines, pathOnly, cwd, base }) {
  return [
    `Change inventory (status, path, lines added and removed; sorted):\n${inventoryText(lines)}`,
    `Where to read: the full redacted diff is in ${patchPath}, with the complete file inventory at the top. The working tree at ${cwd} is readable. No diff is inlined here: read the hunks you need from the patch (Read with successive offsets for a long one) and the surrounding code from the files themselves.${pathOnly.length ? ` ${pathOnly.length} ${pathOnly.length === 1 ? 'file is' : 'files are'} listed by path only in the patch; read ${pathOnly.length === 1 ? 'it' : 'them'} from the working tree.` : ''}`,
    gitLine(base),
  ].join('\n\n');
}

const gitLine = base => `When your tools allow it, you may read history and context with read-only git commands (log, show, blame, diff) or the git_read tool, whichever your tools provide. The base is ${base}. Uncommitted and untracked changes are not in git history; they are in the patch file.`;

async function writeChange(cwd, base, patchPath) {
  const change = await collectChange(cwd, base);
  atomicWrite(patchPath, redactSecrets(change.patch));
  return { text: changeBrief({ patchPath, lines: change.lines, pathOnly: change.pathOnly, cwd, base }), paths: change.paths };
}

const notReadPath = path => path.replace(/\\/g, '/').replace(/^\.\//, '');
// A member that says it read none of the changed files has not reviewed them: its PASS is not counted.
export function applyCoverage(rows, paths) {
  const changed = new Set(paths.map(notReadPath));
  for (const row of rows) {
    if (!row.notRead) continue;
    const listed = new Set(row.notRead.map(notReadPath));
    const all = changed.size > 0 && (isAllNotRead(row.notRead) || [...changed].every(path => listed.has(path)));
    row.notReadCount = all ? changed.size : row.notRead.length;
    if (!all) continue;
    row.notReadAll = true;
    if (row.verdict === 'PASS') {
      row.verdict = 'unknown';
      row.warnings.push('read none of the changed files; its PASS is not counted');
    }
  }
  return rows;
}

function reviewPrompt({ root, cwd, base, plan: selectedPlan, config, scope, round, change, brief, findings }) {
  const discipline = readFileSync(join(root, 'playbook/review.md'), 'utf8');
  const path = planPath(cwd, config, selectedPlan);
  const plan = optionalFile(path);
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
    .replace('<brief, inventory, and patch path>', 'the brief, inventory, and patch path above')
    .replace('Acceptance criteria: <path>', `Acceptance criteria: ${path} and linked criteria above`);
  const sections = [
    'Read-only review. Do not modify files or run write commands.',
    `Range: ${base} to current worktree (including non-ignored untracked files); round ${round}.${round > 1 ? ' Fix diff only: --base must identify the pre-fix revision.' : ''}`,
    ...(brief !== undefined ? [`Lead's brief (purpose, what changed, interfaces touched, what to look at first):\n${boundedContext(redactSecrets(brief))}`] : []),
    `Acceptance criteria (${path}):\n${boundedContext(acceptance || '(no plan)')}`,
    `Known accepted (REVIEW.md):\n${boundedContext(accepted || '(none)')}`,
    ...(findings !== undefined ? [`Lead-adjudicated findings:\nVerify each listed finding is fixed, and also check whether the fix diff introduces new problems.\n${boundedContext(redactSecrets(findings))}`] : []),
    `Review discipline:\n${rules}`,
    change,
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

const reviewerEnvironmentFailures = ['CreateProcessAsUserW failed: 1920', 'code-mode host exited during handshake'];

// Runs one read-only member. A Claude Code too old for --restricted is rerun once with file tools only.
export async function runReadOnly(config, member, prompt, cwd, { timeoutMs, promptPath }) {
  const run = async legacyClaude => {
    const executor = resolveReviewer(config, member, { legacyClaude, cwd });
    if (executor.note) return { executor };
    // The picked settings can hold credentials, so they go in a private temporary file, not on the command line or in summary.json.
    const settingsDir = executor.claudeSettings ? mkdtempSync(join(tmpdir(), 'ff-claude-settings-')) : undefined;
    try {
      if (settingsDir) {
        const file = join(settingsDir, 'settings.json');
        writeFileSync(file, JSON.stringify(executor.claudeSettings), { mode: 0o600 });
        executor.args.push('--settings', file);
      }
      const input = prepareReviewerPrompt(executor, prompt, cwd, promptPath);
      const result = await runProcess(executor.command, executor.args, { cwd, env: executor.env, input, timeoutMs, idleMs: executor.idleMinutes * 60000 });
      return { executor, result };
    } finally {
      if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
    }
  };
  const first = await run(false);
  if (!first.executor.restricted || first.result.exitCode === 0 || !restrictedUnsupported(first.result.stderr)) return first;
  return { ...(await run(true)), fallback: noRestrictedNote };
}

async function runReviewer(config, member, prompt, cwd, minutes, promptPath) {
  const base = { member, model: String(member), status: 'absent', durationMs: 0, verdict: 'unknown', warnings: [] };
  const { executor, result, fallback } = await runReadOnly(config, member, prompt, cwd, { timeoutMs: minutes * 60000, promptPath });
  if (executor.note) return { row: { ...base, note: executor.note }, stdout: `${executor.note}\n`, stderr: '' };
  const signals = reviewerEnvironmentFailures.filter(signature => !prompt.includes(signature));
  const environmentFailure = signals.find(signature => result.stdout.includes(signature) || result.stderr.includes(signature))
    || (executor.promptFile && missingOpencodeAgent(result.stderr) ? 'OpenCode read-only agent unavailable' : undefined);
  const parsed = parseReview(result.stdout);
  let status = environmentFailure || result.idleTimedOut ? 'failed' : result.timedOut ? 'timeout' : result.error || result.exitCode !== 0 || result.signal ? 'failed' : 'completed';
  const auth = status !== 'completed' && (authFailure(result.stderr.slice(-2000)) || (result.exitCode !== null && result.exitCode !== 0 && result.stdout.length < 2000 ? authFailure(result.stdout) : ''));
  if (auth) status = 'auth failed';
  const warnings = [...parsed.warnings, ...(result.outputTruncated ? ['Output truncated: last 4 MiB per stream retained'] : [])];
  const verdict = environmentFailure || auth ? 'unknown' : parsed.verdict === 'PASS' && (status !== 'completed' || result.outputTruncated) ? 'unknown' : parsed.verdict;
  const row = { ...base, verdict, warnings, ...(parsed.notRead ? { notRead: parsed.notRead } : {}), model: executor.model, command: [executor.command, ...executor.args], status, durationMs: result.durationMs, exitCode: result.exitCode, ...(result.idleTimedOut ? { idleTimedOut: true, note: result.reason } : {}), ...(environmentFailure ? { note: environmentFailure } : {}), ...(auth ? { note: `${auth}; log in to ${executor.command} and rerun` } : {}), pid: result.pid, error: result.error };
  if (fallback) row.note = row.note ? `${row.note}; ${fallback}` : fallback;
  return { row, stdout: result.stdout, stderr: result.stderr, outputTruncated: result.outputTruncated };
}

export async function adjudicateReview({ root, cwd, config, scope, review, minutes, promptPath }) {
  const discipline = readFileSync(join(root, 'playbook/review.md'), 'utf8');
  const deciding = discipline.split('## Deciding')[1].split('\n## ')[0].trim();
  const findings = review.rows.filter(row => row.verdict === 'FAIL').map(row => {
    const path = resolve(review.dir, row.output);
    return `Member: ${row.member}\nOriginal findings: ${path}\n${boundedContext(redactSecrets(readFileSync(path, 'utf8')))}`;
  }).join('\n\n');
  const prompt = redactSecrets([
    'Read-only adjudication. Do not modify files or run write commands.',
    `Task scope and acceptance commands:\n${boundedContext(scope)}`,
    `## Deciding\n${deciding}`,
    `Original FAIL findings:\n${findings}\nIf findings are omitted inline, use Read with successive offsets to read their original files through EOF.`,
    review.change ?? `Where to read: the full redacted diff is in ${resolve(review.dir, 'diff.patch')}. The working tree at ${cwd} is readable.`,
    'For each blocking finding, write block or reject, your confidence (high or low), and a reason. If any finding is block, the conclusion must be BLOCK.',
    'Then write a section headed exactly `## For the user`. List, one line each: every finding you rejected with low confidence, and any finding you did not block but think may still be worth fixing or checking. Each line says what the issue is, where (file:line if known), and why it is uncertain. If nothing qualifies, write `None.` under the heading.',
    'Last line: ADJUDICATION: BLOCK or ADJUDICATION: REJECT.',
  ].join('\n\n'));
  const result = await runReviewer(config, config.roles.reviewer, prompt, cwd, minutes, promptPath);
  const last = [...result.stdout.matchAll(/^[ \t]*(?:\*\*)?ADJUDICATION(?:\*\*)?[ \t]*:[ \t]*(?:\*\*)?[ \t]*([^\r\n]*)/gim)].at(-1)?.[1] ?? '';
  const conclusion = /^(BLOCK|REJECT)(?:\s|\*\*|[.,;:!?，。；：！？])*$/i.exec(last)?.[1].toUpperCase();
  const usable = result.row.status === 'completed' && !result.outputTruncated && conclusion;
  const text = redactSecrets(result.stdout);
  let forUser = usable ? parseForUser(text) : undefined;
  // `None.` beside a rejection the lead itself called low confidence is a contradiction: list every rejected finding instead.
  const mismatch = Array.isArray(forUser) && !forUser.length && lowConfidenceRejection(text);
  if (mismatch) forUser = undefined;
  return {
    verdict: usable ? conclusion : 'BLOCK',
    text,
    forUser,
    ...(mismatch ? { forUserMismatch: true } : {}),
    note: usable ? '' : redactSecrets(`Adjudication unavailable (${result.row.status}${result.row.note ? `: ${result.row.note}` : ''}) or missing a final conclusion; counted as BLOCK.\n${result.row.error ?? ''}\n${result.stderr}`),
  };
}

const forUserLimit = { items: 20, chars: 600 };
const forUserHeading = /^[ \t]*#{1,6}[ \t]*(?:\*\*)?[ \t]*For the user[ \t]*:?[ \t]*(?:\*\*)?[ \t]*:?[ \t]*$/i;

// A line before the For the user section that rejects a finding with low confidence.
export function lowConfidenceRejection(text) {
  const lines = String(text).split(/\r?\n/);
  const end = lines.findLastIndex(line => forUserHeading.test(line));
  return lines.slice(0, end < 0 ? lines.length : end).some(line => /\breject/i.test(line) && /\bconfidence\b[^\n]{0,15}\blow\b|\blow\b[ -]?confidence/i.test(line));
}

// The last `## For the user` section of an adjudication, as one string per item; [] for `None.`; undefined when missing or empty, so callers can fall back to listing every rejected finding.
export function parseForUser(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findLastIndex(line => forUserHeading.test(line));
  if (start < 0) return undefined;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[ \t]*#{1,6}[ \t]/.test(line) || /^[ \t]*(?:\*\*)?ADJUDICATION(?:\*\*)?[ \t]*:/i.test(line)) break;
    if (line.trim()) body.push(line);
  }
  const bullet = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
  const bulleted = body.some(line => bullet.test(line));
  const items = [];
  for (const line of body) {
    const item = line.replace(bullet, '').trim();
    // Wrapped continuation lines of a bulleted item join that item.
    if (bulleted && !bullet.test(line) && items.length) items[items.length - 1] += ` ${item}`;
    else items.push(item);
  }
  const none = /^(?:\*\*|_)?none(?:\*\*|_)?[ \t]*[.。]?[ \t]*(?:\*\*|_)?$/i;
  const real = items.filter(item => !none.test(item));
  if (!items.length) return undefined;
  const clipped = real.slice(0, forUserLimit.items).map(item => item.length > forUserLimit.chars ? `${item.slice(0, forUserLimit.chars)}…` : item);
  if (real.length > forUserLimit.items) clipped.push(`${real.length - forUserLimit.items} more items; read the adjudication file.`);
  return clipped;
}

export const diagnosisVerdicts = ['SLIP', 'ENVIRONMENT', 'SPEC', 'UNCLEAR'];

// The last DIAGNOSIS: line decides; bold markup, leading whitespace and trailing punctuation are tolerated. Nothing readable is UNCLEAR.
export function parseDiagnosis(text) {
  const last = [...String(text).matchAll(/^[ \t]*(?:\*\*)?DIAGNOSIS(?:\*\*)?[ \t]*:[ \t]*(?:\*\*)?[ \t]*([^\r\n]*)/gim)].at(-1)?.[1] ?? '';
  return /^(SLIP|ENVIRONMENT|SPEC|UNCLEAR)(?:\s|\*\*|[.,;:!?，。；：！？])*$/i.exec(last)?.[1].toUpperCase() ?? 'UNCLEAR';
}

// A read-only process reads a failed attempt and says why. The same runner serves the lead diagnosis and the consult.
export async function diagnoseFailure({ root, cwd, config, member, scope, evidence, base, minutes, path, prior }) {
  const discipline = readFileSync(join(root, 'playbook/diagnose.md'), 'utf8');
  const [rules, tail] = discipline.split('## Diagnostician prompt');
  const instructions = (tail ?? '').replace(/```[a-z]*\n?/g, '').replace('<path to this file>', join(root, 'playbook/diagnose.md')).trim();
  const change = base
    ? await writeChange(cwd, base, resolve(path.replace(/\.md$/, '.patch'))).then(written => written.text, error => `Diff unavailable (${error.message}). Read the working tree at ${cwd} directly.`)
    : 'No diff: the attempt did not run in a git repository.';
  const prompt = redactSecrets([
    'Read-only diagnosis. Do not modify files or run write commands.',
    `Task card and acceptance commands:\n${boundedContext(scope)}`,
    `Evidence from the failed attempt:\n${boundedContext(evidence || '(none)')}`,
    ...(prior ? [`First diagnosis, by ${prior.member} (${prior.verdict}); judge it rather than assume it:\n${boundedContext(prior.text)}`] : []),
    `Diagnosis discipline:\n${rules.trim()}`,
    `Change made by the attempt:\n${change}`,
    instructions,
  ].join('\n\n'));
  const result = await runReviewer(config, member, prompt, cwd, minutes, path.replace(/\.md$/, '-prompt.md'));
  const available = result.row.status === 'completed' && !result.outputTruncated;
  const note = available ? '' : redactSecrets(`Diagnosis unavailable (${result.row.status}${result.row.note ? `: ${result.row.note}` : ''}).\n${result.row.error ?? ''}\n${result.stderr}`.trim());
  const text = redactSecrets(result.stdout);
  atomicWrite(path, [text, note].filter(Boolean).join('\n\n'));
  return { available, verdict: available ? parseDiagnosis(result.stdout) : 'UNCLEAR', text, note, member };
}

export async function reviewChange({ root, cwd, config, base, risk, round = 1, panel = false, plan, scope, findings: findingsPath, brief: briefPath, minutes = 60 }) {
  const priorFindings = findingsPath === undefined ? undefined : readFileSync(resolve(cwd, findingsPath), 'utf8');
  const brief = briefPath === undefined ? undefined : readFileSync(resolve(cwd, briefPath), 'utf8');
  const members = reviewers(config, risk, round, panel);
  if (!members.length) return { exitCode: 0, rows: [], skipped: 'micro: no reviewers; check your own diff.' };
  if (members.every(member => member === 'host')) return { exitCode: 3, rows: [], skipped: 'Use a clean read-only host sub-agent for this review.' };
  await excludeGitEntries(cwd, ['**/.ff/reviews/']);
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = join(cwd, '.ff/reviews', id);
  // The patch exists before any reviewer starts.
  const { text: change, paths } = await writeChange(cwd, base, resolve(dir, 'diff.patch'));
  const prompt = reviewPrompt({ root, cwd, config, base, plan, scope, round, change, brief, findings: priorFindings });
  const results = await Promise.all(members.map((member, index) => runReviewer(config, member, prompt, cwd, minutes, join(dir, `${index + 1}-prompt.md`)).catch(error => ({ row: { member, model: String(member), status: 'failed', durationMs: 0, verdict: 'unknown', warnings: [], note: error.message }, stdout: `${error.message}\n`, stderr: '' }))));
  // Publish only after every process exits: running peers cannot read this panel's results.
  results.forEach((result, index) => {
    const name = `${index + 1}-${String(result.row.member).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70)}`;
    result.row.output = `${name}.md`;
    atomicWrite(join(dir, result.row.output), redactSecrets(result.stdout));
    atomicWrite(join(dir, `${name}.stderr.txt`), redactSecrets(result.stderr));
  });
  const rows = applyCoverage(results.map(result => result.row), paths);
  const exitCode = rows.some(row => row.verdict === 'FAIL') ? 1 : rows.some(row => row.verdict === 'PASS' && row.status === 'completed') ? 0 : 2;
  atomicWrite(join(dir, 'summary.json'), redactSecrets(`${JSON.stringify({ id, base, risk, round, exitCode, members: rows }, null, 2)}\n`));
  const findings = redactSecrets(results.filter(result => result.row.verdict === 'FAIL').map(result => result.stdout).join('\n\n')).slice(-12000);
  return { exitCode, rows, dir, change, findings };
}

export async function review(args, root, cwd = process.cwd()) {
  const options = diffOptions(args, true);
  const { config } = readConfig(cwd);
  autoSyncAgents(config);
  if (options.round === 1 && ['contract', 'high'].includes(options.risk) && !config.roles.second && !config.review.panel?.length) console.error('Note: no second family configured; one reviewer only.');
  let result;
  try { result = await reviewChange({ root, cwd, config, ...options }); }
  catch (error) { console.error(`Review unavailable: ${error.message}`); return 2; }
  if (result.skipped) { (result.exitCode ? console.error : console.log)(result.skipped); return result.exitCode; }
  console.log('Reviewer | Model | Status | Verdict | Duration');
  for (const row of result.rows) console.log(redactSecrets(`${row.member} | ${row.model} | ${row.status} | ${row.verdict} | ${row.durationMs}ms${row.note ? ` | ${row.note}` : ''}${row.warnings.length ? ` | ${row.warnings.join('; ')}` : ''}`));
  for (const row of result.rows.filter(row => row.notRead?.length)) {
    console.log(redactSecrets(row.notReadAll
      ? `${row.member} read none of the ${row.notReadCount} changed ${row.notReadCount === 1 ? 'file' : 'files'}; a PASS from it is not counted`
      : `${row.member} did not read ${row.notRead.length} changed ${row.notRead.length === 1 ? 'file' : 'files'}: ${row.notRead.slice(0, 20).join(', ')}${row.notRead.length > 20 ? ', ...' : ''}`));
  }
  console.log(join(result.dir, 'summary.json'));
  return result.exitCode;
}
