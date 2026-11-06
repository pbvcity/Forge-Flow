import { diffOptions, readDiff, diffFiles } from './diff.mjs';

const assertion = /\b(?:assert(?:\s*\(|\.[\w]+\s*\()|expect\s*\(|self\.assert\w*\s*\(|pytest\.raises\s*\()|^\s*assert\s+\S/;
const skipped = /\b(?:test|it|describe)\s*\.\s*skip\b|@(?:pytest\.mark\.skip\w*|unittest\.skip\w*)\b/;
const focused = /\b(?:test|it|describe)\s*\.\s*only\b/;
const isTest = path => /(?:^|[/\\])(?:tests?|__tests__)(?:[/\\]|$)|(?:^|[._-])(?:test|spec)(?:[._-]|$)/i.test(path);

export function auditDiff(diff) {
  const groups = { 'Throws and guards': [], 'Config and environment': [], 'State and status': [], 'Deleted assertions': [], 'Skipped or focused tests': [], 'Loosened assertions': [] };
  let testLines = 0, sourceLines = 0, weakened = false;
  for (const file of diffFiles(diff)) {
    const test = isTest(file.path) || isTest(file.oldPath);
    if (test) testLines += file.added.length; else sourceLines += file.added.length;
    const add = (group, entry, suffix = '') => groups[group].push(`${file.path}:${entry.line}: ${entry.text.trim()}${suffix}`);
    const deleted = test ? file.deleted.filter(entry => assertion.test(entry.text)) : [];
    const replacements = test ? file.added.filter(entry => assertion.test(entry.text)) : [];
    const skipAdded = test ? file.added.filter(entry => skipped.test(entry.text)) : [];
    const skipRemoved = test ? file.deleted.filter(entry => skipped.test(entry.text)) : [];
    if ((deleted.length || skipAdded.length > skipRemoved.length) && !replacements.length) weakened = true;
    for (const entry of deleted) add('Deleted assertions', entry, ' (old line)');
    for (const entry of file.added) {
      const text = entry.text;
      if (/\b(?:throw|raise)\b|\bif\s*\(?\s*!|\bif\s+(?:not\s+|.+:\s*(?:return|raise))|\b(?:return\s+(?:false|None|null)|process\.exit\s*\(|reject\s*\(|status\s*\(\s*[45]\d\d)|\bif\b.*\b(?:return|throw)\b/.test(text)) add('Throws and guards', entry);
      if (/\bprocess\.env(?:\.|\[)|\b(?:os\.environ|os\.getenv|config\.)/.test(text) || (/\.(?:json|yaml|yml|toml|ini|env)$/i.test(file.path) && /^\s*["']?[\w.-]+["']?\s*[:=]/.test(text))) add('Config and environment', entry);
      if (/\b(?:state|status|retry|backoff|lock|timeout)\w*\b/i.test(text)) add('State and status', entry);
      if (test && (skipped.test(text) || focused.test(text))) add('Skipped or focused tests', entry);
      if (test && deleted.length && /\b(?:toBeDefined|toBeTruthy|toBeFalsy|assertIsNotNone|assertTrue|assertFalse)\b|\bassert\.(?:ok|match)\s*\(/.test(text)) add('Loosened assertions', entry);
    }
  }
  return { groups, testLines, sourceLines, weakened };
}

export async function audit(args, cwd = process.cwd()) {
  let result, diff;
  try { diff = await readDiff(cwd, diffOptions(args).base); result = auditDiff(diff); }
  catch (error) { console.error(`Audit unavailable: ${error.message}`); return 0; }
  console.log(`Added lines: tests ${result.testLines}, source ${result.sourceLines}`);
  for (const notice of diff.match(/^\[OMITTED: .*\]$/gm) ?? []) console.log(notice);
  for (const [name, hints] of Object.entries(result.groups)) {
    console.log(`\n${name}:`);
    console.log(hints.length ? hints.join('\n') : '  none');
  }
  if (result.weakened) console.log('\nTests weakened: assertion deleted or test skipped without a replacement assertion in the same file.');
  return result.weakened ? 1 : 0;
}
