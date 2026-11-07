import { basename } from 'node:path';
import { notifyChannels, notifySettings, sendNotice } from '../cli/lib/notify.mjs';

export default function notifications(pi) {
  if (process.env.FF_CHILD) return;
  let started = 0, failed = '';
  pi.on('agent_start', () => { if (!started) started = Date.now(); });
  pi.on('agent_end', event => {
    const last = event.messages?.at(-1);
    failed = last?.stopReason === 'error' ? String(last.errorMessage ?? 'The run failed.') : '';
  });
  pi.on('agent_settled', async (event, ctx) => {
    const settings = notifySettings();
    const elapsed = Date.now() - started;
    started = 0;
    if (event.aborted || ctx.mode !== 'tui' || !notifyChannels(settings).length) return;
    if (!failed && elapsed < settings.minMinutes * 60000) return;
    await sendNotice({ event: failed ? 'failed' : 'done', project: basename(ctx.cwd), detail: failed }, { settings }).catch(() => {});
  });
}
