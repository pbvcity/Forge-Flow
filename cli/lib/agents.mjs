// Codex cannot load agents from a plugin, so ff writes ff_review and ff_diagnose
// into ~/.codex/agents/ itself. A marker on the first line says which version wrote
// a file; a file without the marker belongs to the user and is never touched.
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './fsx.mjs';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKER = /^# Managed by Forge Flow (\S+)\. Remove this line to keep your own edits\.(?:\r?\n|$)/;

const READ_ONLY = 'You are read-only. Do not modify, create, or delete any file, do not run commands that write anywhere, and do not commit. Read what the prompt names and report. Your permissions are inherited from the session, so this rule is on you to keep.';

export const AGENTS = [
  {
    name: 'ff_review',
    file: 'ff_review.toml',
    playbook: 'review.md',
    description: 'Read-only reviewer for a diff, patch file, or file list. Use for an independent read of a change at routine tier or above. Finds real loss and ends with VERDICT: PASS or VERDICT: FAIL. Never edits files.',
    task: 'Review only what the prompt gives you: a brief with a file inventory and a patch file path, a diff, or a list of files. Read the hunks you need from the patch and open the code a change touches to confirm a scenario, but do not widen the scope.',
    output: 'Output the required sections from the playbook below (Findings ordered by severity, Can be deleted, Dropped), then a Not read: line naming the changed files you did not read (or Not read: none), then end with exactly one last line: VERDICT: PASS or VERDICT: FAIL. FAIL if any BLOCKER or HIGH remains.',
  },
  {
    name: 'ff_diagnose',
    file: 'ff_diagnose.toml',
    playbook: 'diagnose.md',
    description: 'Read-only diagnosis of a failed task, acceptance run, or review. Use after a first failure, before retrying, to learn whether it was a slip, the environment, or the task itself. Ends with a DIAGNOSIS line. Never edits files.',
    task: 'The prompt gives the task card, the acceptance commands and their output, the failure evidence, and the file inventory of the attempt with the path of its patch file. Find the cause, quote the evidence, and give a concrete fix the next attempt can apply.',
    output: 'Output what failed, the evidence with file:line, and the fix, then end with exactly one last line: DIAGNOSIS: SLIP, DIAGNOSIS: ENVIRONMENT, DIAGNOSIS: SPEC, or DIAGNOSIS: UNCLEAR, as the playbook below defines them.',
  },
];

export function readVersion(root = defaultRoot) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

// TOML multi-line basic string: backslashes escape, a run of three quotes ends it,
// and a carriage return is allowed only before a line feed, so line ends become LF.
export function tomlMultiline(text) {
  const body = text.replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/"""/g, '""\\"').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return `"""\n${body}${body.endsWith('\n') ? '' : '\n'}"""`;
}
function tomlString(text) {
  return JSON.stringify(text);
}

// Renders one agent file. A missing playbook leaves that section out and says so.
export function renderAgent(agent, { root = defaultRoot, version = readVersion(root) } = {}) {
  const path = join(root, 'playbook', agent.playbook);
  let playbook = '', warning;
  try { playbook = readFileSync(path, 'utf8'); }
  catch { warning = `${agent.file}: playbook/${agent.playbook} is missing, so the agent carries no playbook section`; }
  const parts = [READ_ONLY, agent.task, agent.output];
  if (playbook) parts.push(`--- playbook/${agent.playbook} ---\n\n${playbook.trim()}`);
  const text = [
    `# Managed by Forge Flow ${version}. Remove this line to keep your own edits.`,
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    `developer_instructions = ${tomlMultiline(parts.join('\n\n'))}`,
    '',
  ].join('\n');
  return { text, warning };
}

// Follows links, so a linked ~/.codex still counts as installed; the link check below keeps it unwritten.
function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}
function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

// States: missing, synced, stale (marker from another version or older content), user (no marker), link.
export function agentState(path, rendered) {
  if (isLink(path)) return { state: 'link' };
  if (!existsSync(path)) return { state: 'missing' };
  const current = readFileSync(path, 'utf8');
  const marker = MARKER.exec(current);
  if (!marker) return { state: 'user' };
  if (current === rendered) return { state: 'synced', version: marker[1] };
  return { state: 'stale', version: marker[1] };
}

export function codexHome(home = homedir(), env = process.env) {
  return env.CODEX_HOME || join(home, '.codex');
}

// Previews or writes the agent files. Returns one row per agent; writes only with apply.
export function syncAgents({ root = defaultRoot, home = homedir(), env = process.env, apply = false, version = readVersion(root) } = {}) {
  if (env.CODEX_HOME && !isAbsolute(env.CODEX_HOME)) {
    const skipped = `CODEX_HOME is a relative path (${env.CODEX_HOME}); set it to an absolute path to sync agents`;
    return { codex: true, skipped, dir: join(env.CODEX_HOME, 'agents'), rows: [], warnings: [skipped] };
  }
  const codex = codexHome(home, env);
  if (!isDirectory(codex)) return { codex: false, dir: join(codex, 'agents'), rows: [], warnings: [] };
  const dir = join(codex, 'agents');
  const warnings = [];
  if (isLink(codex) || isLink(dir)) {
    warnings.push(`${isLink(codex) ? codex : dir} is a link; Forge Flow writes agents only into a real ~/.codex/agents directory`);
    return { codex: true, dir, rows: AGENTS.map(agent => ({ file: agent.file, path: join(dir, agent.file), state: 'link', action: 'kept' })), warnings };
  }
  const rows = AGENTS.map((agent) => {
    const path = join(dir, agent.file);
    const { text, warning } = renderAgent(agent, { root, version });
    if (warning) warnings.push(warning);
    const { state, version: found } = agentState(path, text);
    const row = { file: agent.file, path, state, found, action: 'kept' };
    if (state === 'missing' || state === 'stale') {
      row.action = apply ? 'wrote' : (state === 'missing' ? 'would create' : 'would update');
      if (apply) atomicWrite(path, text, 0o644);
    }
    return row;
  });
  return { codex: true, dir, rows, warnings };
}

export function describeRow(row, version) {
  if (row.state === 'synced') return `${row.path}: synced (${version})`;
  if (row.state === 'user') return `${row.path}: kept, it has no Forge Flow marker line, so it is yours`;
  if (row.state === 'link') return `${row.path}: kept, link`;
  if (row.action === 'wrote') return `wrote ${row.path}${row.state === 'stale' ? ` (was ${row.found})` : ''}`;
  if (row.state === 'missing') return `${row.path}: would create`;
  return `${row.path}: would update (marked ${row.found}, this is ${version})`;
}

// Called at the start of run, review, and doctor. Never throws; a failure is one warning line.
// Its lines go to stderr so they never mix into a command's own output, such as the review table.
export function autoSyncAgents(config, { root = defaultRoot, log = console.error, warn = console.error } = {}) {
  if (config?.agents?.sync === false) return null;
  try {
    const version = readVersion(root);
    const result = syncAgents({ root, apply: true, version });
    if (!result.codex) return result;
    for (const warning of result.warnings) warn(`Codex agents: ${warning}`);
    for (const row of result.rows) {
      if (row.action === 'wrote') log(describeRow(row, version));
      else if (row.state === 'user') warn(`Codex agents: ${describeRow(row, version)}`);
    }
    return result;
  } catch (error) {
    warn(`Codex agents sync skipped: ${error.message}`);
    return null;
  }
}

// One line for doctor: each file's state, or that Codex is not installed.
export function agentsStatus({ root = defaultRoot, home = homedir(), env = process.env } = {}) {
  try {
    const version = readVersion(root);
    const result = syncAgents({ root, home, env, version });
    if (!result.codex) return 'Codex not installed (no ~/.codex)';
    if (result.skipped) return `not synced: ${result.skipped}`;
    const words = { missing: 'missing', synced: 'synced', stale: 'outdated', user: 'user-owned', link: 'link, kept' };
    return result.rows.map(row => `${row.file.replace(/\.toml$/, '')} ${words[row.state]}${row.state === 'stale' ? ` (${row.found})` : ''}`).join(', ');
  } catch (error) {
    return `unknown (${error.message})`;
  }
}

export async function agents(args, root = defaultRoot) {
  const apply = args.includes('--apply');
  const unknown = args.filter(arg => arg !== '--apply');
  if (unknown.length) throw new Error('usage: ff agents [--apply]');
  const version = readVersion(root);
  const result = syncAgents({ root, apply, version });
  if (!result.codex) { console.log(`Codex is not installed (no ${dirname(result.dir)}); nothing to sync.`); return 0; }
  for (const warning of result.warnings) console.error(`Note: ${warning}`);
  for (const row of result.rows) console.log(describeRow(row, version));
  if (!apply && result.rows.some(row => row.action.startsWith('would'))) console.log('Preview only. Run ff agents --apply to write.');
  return 0;
}
