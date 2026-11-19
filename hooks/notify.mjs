#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { attended, handleHook } from '../cli/lib/notify.mjs';
import { rulesReminder } from '../cli/lib/rules.mjs';

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  // Claude Code and Codex both add a SessionStart hook's additionalContext to the session.
  if (payload?.hook_event_name === 'SessionStart' && !process.env.FF_CHILD && attended(payload)) {
    try {
      const context = rulesReminder(payload.cwd ?? process.cwd());
      if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
    } catch {}
  }
  await handleHook(payload);
} catch {}
process.exit(0);
