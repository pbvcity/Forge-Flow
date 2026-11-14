import { git } from './git.mjs';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

// The patch reviewers read: whole-file cap 16 MiB; an untracked file over 1 MiB is listed by path only.
export const patchLimit = 16 * 1024 * 1024;
export const untrackedFileLimit = 1024 * 1024;
export const inventoryLimit = 200;
const gitOutput = { maxOutputBytes: 32 * 1024 * 1024 };

export function diffOptions(args, reviewing = false) {
  const options = { round: 1, minutes: 60, panel: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (reviewing && flag === '--panel') { options.panel = true; continue; }
    const key = { '--base': 'base', ...(reviewing ? { '--risk': 'risk', '--round': 'round', '--timeout-min': 'minutes', '--plan': 'plan', '--findings': 'findings', '--brief': 'brief' } : {}) }[flag];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${flag}`);
    options[key] = ['round', 'minutes'].includes(key) ? Number(args[++i]) : args[++i];
  }
  if (!options.base || options.base.startsWith('-')) throw new Error('--base <ref> is required');
  if (reviewing && (!['micro', 'routine', 'contract', 'high'].includes(options.risk) || !Number.isInteger(options.round) || options.round < 1 || !(options.minutes > 0 && Number.isFinite(options.minutes)))) {
    throw new Error('review requires --risk micro|routine|contract|high, a positive --round and --timeout-min');
  }
  return options;
}

function complete(result, what) {
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error(`${what} unavailable or incomplete: ${result.stderr || result.error || 'git output limit reached'}`);
  return result.stdout;
}

async function untrackedFiles(cwd) {
  return complete(await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], gitOutput), 'Untracked files').split('\0').filter(Boolean);
}

// One untracked file as a patch, or undefined when it does not fit in maxBytes.
async function untrackedPatch(cwd, file, maxBytes) {
  if (maxBytes <= 0 || lstatSync(join(cwd, file)).size > maxBytes) return undefined;
  const added = await git(cwd, ['-c', 'core.quotePath=false', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--unified=3', '--', '/dev/null', file], { maxOutputBytes: Math.min(gitOutput.maxOutputBytes, maxBytes) });
  if (![0, 1].includes(added.exitCode) || added.timedOut) throw new Error(`Untracked diff unavailable or incomplete (${file}): ${added.stderr || added.error || 'git output limit reached'}`);
  return added.outputTruncated ? undefined : added.stdout;
}

// The inline diff `ff audit` and the run's own checks read; at most 200 untracked files.
export async function readDiff(cwd, base) {
  const tracked = complete(await git(cwd, ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--unified=3', base, '--'], gitOutput), 'Diff');
  const files = await untrackedFiles(cwd);
  const chunks = [Buffer.byteLength(tracked) > patchLimit ? `${Buffer.from(tracked).subarray(0, patchLimit).toString('utf8').replace(/[^\n]*$/, '')}\n[OMITTED: tracked diff beyond the full diff byte limit]\n` : tracked];
  let bytes = Math.min(Buffer.byteLength(tracked), patchLimit);
  for (const file of files.slice(0, 200)) {
    const text = await untrackedPatch(cwd, file, patchLimit - bytes);
    if (text === undefined) { chunks.push(`\n[OMITTED: oversized untracked file ${JSON.stringify(file)}; full diff content limit (${patchLimit} bytes)]\n`); continue; }
    chunks.push(text);
    bytes += Buffer.byteLength(text);
  }
  if (files.length > 200) chunks.push(`\n[OMITTED: ${files.length - 200} untracked files beyond the 200-file limit]\n`);
  return chunks.join('');
}

const statusNames = { A: 'added', D: 'deleted', R: 'renamed', C: 'copied', M: 'modified', T: 'type changed' };

function parseNameStatus(text) {
  const tokens = text.split('\0');
  const entries = [];
  for (let i = 0; i < tokens.length;) {
    const code = tokens[i++];
    if (!code) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') entries.push({ status: statusNames[letter], oldPath: tokens[i++], path: tokens[i++] });
    else entries.push({ status: statusNames[letter] ?? 'modified', path: tokens[i++] });
  }
  return entries;
}

function parseNumstat(text) {
  const tokens = text.split('\0');
  const counts = new Map();
  for (let i = 0; i < tokens.length;) {
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(tokens[i++]);
    if (!match) continue;
    const path = match[3] === '' ? (i++, tokens[i++]) : match[3];
    counts.set(path, { added: match[1] === '-' ? null : Number(match[1]), deleted: match[2] === '-' ? null : Number(match[2]) });
  }
  return counts;
}

const counted = (patch) => patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length;

// Every change since base (tracked and non-ignored untracked) as one patch plus a per-file inventory.
// Nothing is dropped from the inventory; content past the caps is listed in `pathOnly` instead.
export async function collectChange(cwd, base, { maxPatchBytes = patchLimit, maxFileBytes = untrackedFileLimit } = {}) {
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames'];
  const tracked = complete(await git(cwd, ['-c', 'core.quotePath=false', ...common, '--unified=3', base, '--'], gitOutput), 'Diff');
  const counts = parseNumstat(complete(await git(cwd, [...common, '--numstat', '-z', base, '--'], gitOutput), 'Diff inventory'));
  const entries = parseNameStatus(complete(await git(cwd, [...common, '--name-status', '-z', base, '--'], gitOutput), 'Diff inventory'))
    .map(entry => ({ ...entry, ...(counts.get(entry.path) ?? { added: null, deleted: null }) }));
  const pathOnly = [];
  const chunks = [tracked];
  let bytes = Buffer.byteLength(tracked);
  if (bytes > maxPatchBytes) {
    const kept = Buffer.from(tracked).subarray(0, maxPatchBytes).toString('utf8').replace(/[^\n]*$/, '');
    // The file cut in half and every later tracked file lose content; `--name-status` lists them in patch order.
    const started = (kept.match(/^diff --git /gm) ?? []).length;
    pathOnly.push(...entries.slice(Math.max(0, started - 1)).map(entry => entry.path));
    chunks[0] = `${kept}\n[OMITTED: tracked diff beyond the ${maxPatchBytes}-byte patch limit; files listed by path only below]\n`;
    bytes = maxPatchBytes;
  }
  for (const file of await untrackedFiles(cwd)) {
    const text = lstatSync(join(cwd, file)).size > maxFileBytes ? undefined : await untrackedPatch(cwd, file, maxPatchBytes - bytes);
    if (text === undefined) {
      pathOnly.push(file);
      entries.push({ status: 'added', path: file, added: null, deleted: 0 });
      continue;
    }
    chunks.push(text);
    bytes += Buffer.byteLength(text);
    entries.push({ status: 'added', path: file, added: /^Binary files /m.test(text) ? null : counted(text), deleted: 0 });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const only = new Set(pathOnly);
  const lines = entries.map(entry => `${entry.status} ${entry.path}${entry.oldPath ? ` (from ${entry.oldPath})` : ''}: ${entry.added === null ? 'binary or not counted' : `+${entry.added} -${entry.deleted ?? 0}`}${only.has(entry.path) ? ' [path only in the patch]' : ''}`);
  const header = `File inventory (${lines.length} files):\n${lines.join('\n')}${pathOnly.length ? `\n\nListed by path only (over ${maxFileBytes} bytes for one untracked file, or past the ${maxPatchBytes}-byte patch limit); read them from the working tree:\n${pathOnly.join('\n')}` : ''}`;
  return { patch: `${header}\n\n${chunks.join('')}`, lines, pathOnly, paths: entries.map(entry => entry.path) };
}

// The inventory as it appears in a prompt: sorted, capped, with a count of the rest.
export function inventoryText(lines, limit = inventoryLimit) {
  if (!lines.length) return '(no files changed)';
  return [...lines.slice(0, limit), ...(lines.length > limit ? [`and ${lines.length - limit} more files; the patch lists every file at the top`] : [])].join('\n');
}

export function diffFiles(diff) {
  const files = [];
  let file, oldLine = 0, newLine = 0;
  const path = text => {
    if (text.startsWith('"')) { try { text = JSON.parse(text); } catch {} }
    return text.replace(/^[ab]\//, '');
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { file = { path: '', oldPath: '', added: [], deleted: [] }; files.push(file); continue; }
    if (!file) continue;
    if (line.startsWith('--- ')) { file.oldPath = path(line.slice(4).replace(/\t.*$/, '')); continue; }
    if (line.startsWith('+++ ')) { file.path = path(line.slice(4).replace(/\t.*$/, '')); if (file.path === '/dev/null') file.path = file.oldPath; continue; }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); continue; }
    if (!file.path || line.startsWith('\\')) continue;
    if (line.startsWith('+')) file.added.push({ line: newLine++, text: line.slice(1) });
    else if (line.startsWith('-')) file.deleted.push({ line: oldLine++, text: line.slice(1) });
    else if (line.startsWith(' ')) { newLine++; oldLine++; }
  }
  return files.filter(file => file.path);
}
