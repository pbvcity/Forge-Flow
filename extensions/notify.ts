import { basename } from 'node:path';
import { markedNotice, notifyChannels, notifySettings, sendNotice } from '../cli/lib/notify.mjs';

export default function notifications(pi) {
  if (process.env.FF_CHILD) return;
  let failed = '', reply = '';
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
