import { basename } from 'node:path';
import { markedNotice, notifyChannels, notifySettings, sendNotice } from '../cli/lib/notify.mjs';
import { rulesReminder } from '../cli/lib/rules.mjs';

export default function notifications(pi) {
  if (process.env.FF_CHILD) return;
  let failed = '', reply = '';
  // Pi has no SessionStart hook; a prompt section carries the same one-line reminder in an interactive session.
  pi.on('before_agent_start', (event, ctx) => {
    const sections = event.systemPromptOptions?.sections;
    if (!sections || ctx.mode !== 'tui') return;
    try {
      const reminder = rulesReminder(ctx.cwd);
      if (reminder) sections['ff-rules'] = reminder;
    } catch {}
  });
  pi.on('agent_end', event => {
    const last = event.messages?.at(-1);
    failed = last?.stopReason === 'error' ? String(last.errorMessage ?? 'The run failed.') : '';
    reply = Array.isArray(last?.content) ? last.content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : String(last?.content ?? '');
  });
  pi.on('agent_settled', async (event, ctx) => {
    const settings = notifySettings();
    const notice = failed ? { event: 'failed', detail: failed } : markedNotice(reply);
    failed = reply = '';
    if (!notice || event.aborted || ctx.mode !== 'tui' || !notifyChannels(settings).length) return;
    await sendNotice({ ...notice, project: basename(ctx.cwd) }, { settings }).catch(() => {});
  });
}
