import { readFileSync } from 'node:fs';
import { readConfig } from './config.mjs';
import { planningFile } from './paths.mjs';

export function localDate(now = Date.now()) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Parse the line-oriented FOLLOWUPS format, with fenced examples excluded.
export function parseFollowups(text, today = localDate()) {
  const items = [], notes = [];
  let fence;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    if (!/^ {0,3}[-*+]\s/.test(line)) continue;
    const match = line.match(/^ {0,3}[-*+] \[([ xX])\] (\d{4}-\d{2}-\d{2}) (.+?)\s+Evidence:\s*(\S.*)$/);
    const date = match && new Date(`${match[2]}T00:00:00Z`);
    if (!match || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[2]) {
      notes.push(`Skipped malformed follow-up at line ${index + 1}: ${line.trim()}`);
      continue;
    }
    if (match[1].toLowerCase() === 'x') continue;
    items.push({ date: match[2], text: match[3], evidence: match[4].trim(), line: index + 1, due: match[2] <= today });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { items, notes };
}

export function readFollowups(cwd, today = localDate(), config = readConfig(cwd, undefined, () => {}).config) {
  try { return parseFollowups(readFileSync(planningFile(cwd, config, 'FOLLOWUPS.md'), 'utf8'), today); }
  catch (error) {
    if (error.code === 'ENOENT') return { items: [], notes: [] };
    return { items: [], notes: [`Cannot read FOLLOWUPS.md: ${error.message}`] };
  }
}

export const followupLine = item => `- [ ] ${item.date} ${item.text} Evidence: ${item.evidence}`;

export function dueFollowupLines(cwd) {
  const due = readFollowups(cwd).items.filter(item => item.due);
  return due.length ? [`Due follow-ups: ${due.length} (FOLLOWUPS.md)`, ...due.map(followupLine)] : [];
}

export function followups(args = [], cwd = process.cwd()) {
  if (args.length) { console.error('usage: ff followups'); return 2; }
  const { items, notes } = readFollowups(cwd);
  console.log(items.length ? `Open follow-ups: ${items.length} (${items.filter(item => item.due).length} due)` : 'No open follow-ups.');
  for (const item of items) console.log(followupLine(item));
  for (const note of notes) console.log(note);
  return 0;
}
