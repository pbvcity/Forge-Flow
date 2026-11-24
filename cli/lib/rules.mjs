// Forge Flow writes rule sections into rules files: Files and folders and Notifications into a project's
// AGENTS.md or CLAUDE.md (init), and Delegation into the user's ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, or
// ~/.pi/agent/AGENTS.md (setup). Agents translate and adapt them, so the text cannot be compared. One marker per
// file records the version of ff's rules it was last aligned with; the init skill compares meaning and edits.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const RULES_VERSION = 3;
// What changed in each version, for an agent aligning a file written at an older one. Each change names the
// files it applies to: project rules (init's sections) or user rules (setup's Delegation section).
export const RULES_CHANGES = {
  2: { scope: 'project', text: 'Notifications: a turn woken by a heartbeat, a scheduled wakeup, or a background-task notice is not a new request; if it only reports progress, it writes no marker. Each marker is written once: after `<!-- ff-await -->`, do not write it again until the user replies. From a heartbeat, run `ff notify send` only when something changed since the last notice.' },
  3: { scope: 'project', text: 'Notifications: Markers and notices are for a user who has stepped away. In a live exchange, a quick answer, or a small change the user is watching, write no marker and send nothing: they will read the reply. Write one when the turn ran long, or when it ends a long or multi-step task.' },
};

const markerPattern = /<!-- forge-flow rules (\d+) -->/;
export const rulesMarker = (version = RULES_VERSION) => `<!-- forge-flow rules ${version} -->`;
// Commands, markers, and tier names stay in English in a translated section, so they mark ff's rules in any language.
const ffContent = /(?<![\w-])(?:ff-await|ff-done|ff[-_](?:light|standard|deep)\b|ff wt clean|ff notify send|ff status)/;

const readText = path => { try { return readFileSync(path, 'utf8'); } catch { return null; } };

// The version a rules file was aligned with: its marker, or 1 for ff content written before markers.
export function fileRulesVersion(text) {
  const marked = text?.match(markerPattern);
  if (marked) return Number(marked[1]);
  return text && ffContent.test(text) ? 1 : 0;
}

export function rulesFiles(cwd, { home = homedir(), env = process.env } = {}) {
  const candidates = [
    ...['AGENTS.md', 'CLAUDE.md'].map(name => ({ scope: 'project', path: join(cwd, name), label: name })),
    { scope: 'user', path: join(home, '.claude', 'CLAUDE.md'), label: '~/.claude/CLAUDE.md' },
    { scope: 'user', path: join(env.CODEX_HOME || join(home, '.codex'), 'AGENTS.md'), label: env.CODEX_HOME ? join(env.CODEX_HOME, 'AGENTS.md') : '~/.codex/AGENTS.md' },
    { scope: 'user', path: join(home, '.pi', 'agent', 'AGENTS.md'), label: '~/.pi/agent/AGENTS.md' },
  ];
  return candidates.flatMap(file => {
    const version = fileRulesVersion(readText(file.path));
    return version ? [{ ...file, version, changes: changesSince(version, file.scope) }] : [];
  });
}

// A file is behind only when a later version changed rules of its kind.
export const staleRules = (cwd, options) => rulesFiles(cwd, options).filter(file => file.changes.length);

// One line for a new session: no rule text, so the files' own wording stays in force until the user decides.
export function rulesReminder(cwd, options) {
  const stale = staleRules(cwd, options);
  if (!stale.length) return '';
  return `Forge Flow's rules have changed since ${stale.map(file => `${file.label} (rules ${file.version})`).join(', ')} ${stale.length === 1 ? 'was' : 'were'} last aligned; the current version is ${RULES_VERSION}. Offer the user once to align them with the init skill (/ff:init), which shows the proposed edits before changing anything.`;
}

export const changesSince = (version, scope) => Object.entries(RULES_CHANGES)
  .filter(([number, change]) => Number(number) > version && change.scope === scope).map(([number, change]) => `${number}: ${change.text}`);

// Records that a file is aligned with the current rules: replaces its marker, or appends one line.
// A marker from a newer Forge Flow is kept.
export function markRules(path, version = RULES_VERSION) {
  const text = readFileSync(path, 'utf8');
  if (Number(text.match(markerPattern)?.[1]) >= version) return;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const updated = markerPattern.test(text) ? text.replace(markerPattern, rulesMarker(version))
    : `${text}${text && !text.endsWith('\n') ? eol : ''}${text ? eol : ''}${rulesMarker(version)}${eol}`;
  if (updated !== text) writeFileSync(path, updated, 'utf8');
}
