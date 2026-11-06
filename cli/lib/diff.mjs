import { git } from './git.mjs';

export function diffOptions(args, reviewing = false) {
  const options = { round: 1, minutes: 60, panel: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (reviewing && flag === '--panel') { options.panel = true; continue; }
    const key = { '--base': 'base', ...(reviewing ? { '--risk': 'risk', '--round': 'round', '--timeout-min': 'minutes', '--plan': 'plan' } : {}) }[flag];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${flag}`);
    options[key] = ['round', 'minutes'].includes(key) ? Number(args[++i]) : args[++i];
  }
  if (!options.base || options.base.startsWith('-')) throw new Error('--base <ref> is required');
  if (reviewing && (!['micro', 'routine', 'contract', 'high'].includes(options.risk) || !Number.isInteger(options.round) || options.round < 1 || !(options.minutes > 0 && Number.isFinite(options.minutes)))) {
    throw new Error('review requires --risk micro|routine|contract|high, a positive --round and --timeout-min');
  }
  return options;
}

export async function readDiff(cwd, base) {
  const result = await git(cwd, ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--unified=3', base, '--'], { maxOutputBytes: 32 * 1024 * 1024 });
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error(`Diff unavailable or incomplete: ${result.stderr || result.error || 'git output limit reached'}`);
  const options = { maxOutputBytes: 32 * 1024 * 1024 };
  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], options);
  if (untracked.exitCode !== 0 || untracked.timedOut || untracked.outputTruncated) throw new Error(`Untracked files unavailable or incomplete: ${untracked.stderr || untracked.error || 'git output limit reached'}`);
  const files = untracked.stdout.split('\0').filter(Boolean);
  let diff = result.stdout;
  for (const file of files.slice(0, 200)) {
    const added = await git(cwd, ['-c', 'core.quotePath=false', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--unified=3', '--', '/dev/null', file], options);
    if (![0, 1].includes(added.exitCode) || added.timedOut || added.outputTruncated) throw new Error(`Untracked diff unavailable or incomplete (${file}): ${added.stderr || added.error || 'git output limit reached'}`);
    diff += added.stdout;
  }
  if (files.length > 200) diff += `\n[OMITTED: ${files.length - 200} untracked files beyond the 200-file limit]\n`;
  return diff;
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

export const diffLimit = 96 * 1024;

export function boundedDiff(diff, limit = diffLimit) {
  if (Buffer.byteLength(diff) <= limit) return diff;
  const files = diffFiles(diff);
  const summary = files.map(file => `${file.path}: +${file.added.length} -${file.deleted.length}`).join('\n');
  // Keep complete lines, with space reserved for the deterministic inventory.
  const inventory = Buffer.from(summary).subarray(0, limit / 4).toString('utf8');
  const prefix = Buffer.from(diff).subarray(0, limit - Buffer.byteLength(inventory) - 512).toString('utf8').replace(/[^\n]*$/, '');
  return `${prefix}\n[OMITTED: ${Buffer.byteLength(diff) - Buffer.byteLength(prefix)} diff bytes after this prefix. Inventory: ${files.length} files; inventory may also be truncated.]\n${inventory}`;
}
