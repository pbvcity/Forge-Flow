import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicWrite } from './fsx.mjs';

export const unquote = text => text.trim().replace(/^`(.*)`$/, '$1');
const ids = text => [...text.matchAll(/\bT\d\w*(?:[.-]\w+)*\b/gi)].map(match => match[0].toUpperCase());
const holdSections = ['needs a person', 'direction choices'];

function acceptLine(task, text) {
  const command = unquote(text.replace(/^\s*[-*]\s+/, '')).trim();
  if (command && !command.startsWith('#')) task.accept.push(command);
}

function readField(task, name, value) {
  if (name === 'accept') { acceptLine(task, value); return; }
  task.details.push(`${name}: ${value}`);
  if (name === 'risk') task.risk = value.match(/\w+/)?.[0].toLowerCase();
  if (name === 'depends' && !/^(?:none|no|-)?\s*$/i.test(value.replace(/`/g, ''))) {
    task.depends.push(...value.replace(/`/g, '').split(/[,;\s]+/).filter(Boolean).map(id => id.replace(/[.:]$/, '').toUpperCase()));
  }
}

export function parsePlan(text) {
  const lines = text.split(/\r?\n/), tasks = [], notes = [], holds = [];
  let section = '', current = null, field = '', fence = false, hold = { open: false, text: '' };
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) {
      if (section !== 'tasks' || !current) continue;
      if (field === 'accept') acceptLine(current, line); else current.details.push(line);
      current.body.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (section !== 'tasks' || heading[1].length < 3) section = heading[2].trim().toLowerCase();
      current = null; field = '';
      continue;
    }
    if (holdSections.includes(section)) {
      const item = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s*)?(.*)$/);
      if (item) hold = { open: item[1]?.toLowerCase() !== 'x', text: item[2] };
      const blocks = hold.open && line.match(/\bBlocks:(.*)$/i)?.[1];
      if (blocks) for (const id of /^\s*all\b/i.test(blocks) ? ['*'] : ids(blocks)) holds.push({ id, reason: `${section}: ${hold.text}` });
      continue;
    }
    if (section !== 'tasks') continue;
    const match = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+)(T\d\w*(?:[.-]\w+)*)\s*[:.)-]?\s+(.+?)\s*$/i);
    if (match) {
      current = { id: match[4].toUpperCase(), title: match[5], done: match[2].toLowerCase() === 'x', line: index, body: [], details: [], accept: [], depends: [] };
      field = '';
      tasks.push(current);
      continue;
    }
    if (/^\s*[-*+]\s+\[/.test(line)) { notes.push(`Skipped unparseable task at line ${index + 1}: ${line.trim()}`); current = null; continue; }
    if (!current) continue;
    current.body.push(line);
    const named = line.match(/^\s*(Accept|Depends|Files|Risk):\s*(.*)$/i);
    if (named) { field = named[1].toLowerCase(); readField(current, field, named[2]); continue; }
    if (field === 'accept' && line.trim()) { acceptLine(current, line); continue; }
    current.details.push(line);
    if (!line.trim()) field = '';
  }
  const usable = tasks.filter(task => {
    if (tasks.filter(other => other.id === task.id).length === 1) return true;
    notes.push(`Skipped duplicate task ${task.id}; give each task a unique ID.`);
    return false;
  });
  for (const task of usable) {
    task.signature = createHash('sha256').update(JSON.stringify([task.id, task.title, task.body.map(line => line.trim()).join('\n').trim()])).digest('hex');
  }
  const exit = lines.find(line => /^\s*Exit condition:/i.test(line))?.replace(/^\s*Exit condition:\s*/i, '').trim() ?? '';
  const risk = lines.find(line => /^\s*Risk:/i.test(line))?.match(/^\s*Risk:\s*(\w+)/i)?.[1].toLowerCase();
  const goal = lines.find(line => /^#\s/.test(line))?.replace(/^#\s+/, '') ?? '';
  const outcome = lines.find(line => /^\s*Outcome:/i.test(line))?.replace(/^\s*Outcome:\s*/i, '').trim() ?? '';
  return { text, lines, tasks: usable, notes, holds, goal, outcome, risk, exit, exitCommand: exit.match(/^`([^`]+)`/)?.[1] ?? '' };
}

export const readPlan = (cwd, path = 'PLAN.md') => parsePlan(readFileSync(resolve(cwd, path), 'utf8'));

export function writePlan(cwd, path, text) {
  const file = resolve(cwd, path);
  let mode;
  try { mode = statSync(file).mode & 0o777; } catch {}
  atomicWrite(file, text, mode);
}
export const holdOn = (plan, task) => plan.holds.find(item => item.id === task.id || item.id === '*');

export function setBox(cwd, path, id, checked) {
  const plan = readPlan(cwd, path), task = plan.tasks.find(item => item.id === id);
  if (!task || task.done === checked) return false;
  plan.lines[task.line] = plan.lines[task.line].replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
  writePlan(cwd, path, plan.lines.join(plan.text.includes('\r\n') ? '\r\n' : '\n'));
  return true;
}
