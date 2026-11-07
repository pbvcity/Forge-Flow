import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { followupLine, localDate, readFollowups } from './followups.mjs';

const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DETAIL = 500;
const LABELS = {
  en: { done: 'Finished', waiting: 'Waiting for you', permission: 'Needs your approval', failed: 'Failed', paused: 'Paused', followups: 'Follow-ups due', test: 'Test message' },
  zh: { done: '任务完成', waiting: '等你回应', permission: '等你批准', failed: '出错了', paused: '已暂停', followups: '有跟进到期', test: '测试消息' },
};

export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

export function notifySettings(env = process.env, home = homedir()) {
  let file = {};
  try { file = parseEnvFile(readFileSync(join(home, '.ff/notify.env'), 'utf8')); } catch {}
  const value = key => String(env[key] ?? file[key] ?? '').trim();
  const minutes = Number(value('FF_NOTIFY_MIN_MINUTES') || 5);
  return {
    webhook: value('FF_NOTIFY_WEBHOOK'),
    botToken: value('FF_TELEGRAM_BOT_TOKEN'),
    chatId: value('FF_TELEGRAM_CHAT_ID'),
    minMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 5,
    lang: value('FF_NOTIFY_LANG') === 'zh' ? 'zh' : 'en',
  };
}

export function notifyChannels(settings) {
  return [settings.webhook ? 'webhook' : '', settings.botToken && settings.chatId ? 'telegram' : ''].filter(Boolean);
}

export function redact(text) {
  return String(text ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[hidden]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[hidden]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[hidden]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '[hidden]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, 'Bearer [hidden]')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY)[A-Z0-9_]*)(["']?)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1$2=[hidden]');
}

export function noticeText({ event, project, detail }, lang = 'en') {
  const body = redact(detail).trim();
  const short = body.length > MAX_DETAIL ? `${body.slice(0, MAX_DETAIL)}…` : body;
  return [`[Forge Flow] ${project}: ${LABELS[lang][event] ?? event}`, short].filter(Boolean).join('\n');
}

async function post(url, body, fetcher, timeoutMs) {
  const response = await fetcher(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

// Failures name the channel and status only, because a Telegram URL contains the token.
export async function sendNotice(notice, { settings = notifySettings(), fetcher = fetch, timeoutMs = 10000 } = {}) {
  const text = noticeText(notice, settings.lang);
  const sends = [];
  if (settings.webhook) sends.push(['webhook', settings.webhook, { text, event: notice.event, project: notice.project }]);
  if (settings.botToken && settings.chatId) sends.push(['telegram', `https://api.telegram.org/bot${settings.botToken}/sendMessage`, { chat_id: settings.chatId, text }]);
  const results = await Promise.allSettled(sends.map(([, url, body]) => post(url, body, fetcher, timeoutMs)));
  const failed = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    const status = result.reason?.message?.match(/^HTTP \d+$/)?.[0];
    failed.push(status ? `${sends[index][0]} (${status})` : sends[index][0]);
  });
  return { sent: sends.length - failed.length, failed };
}

function sessionFile(home, session) {
  const dir = join(home, '.ff/notify-state');
  mkdirSync(dir, { recursive: true });
  return { dir, file: join(dir, `${createHash('sha256').update(String(session)).digest('hex').slice(0, 16)}.json`) };
}

function readSession(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

function prune(dir, now) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try { if (now - statSync(path).mtimeMs > STALE_MS) rmSync(path, { force: true }); } catch {}
  }
}

async function notifyFollowups(cwd, { settings, home, now, fetcher }) {
  const today = localDate(now);
  const due = readFollowups(cwd, today).items.filter(item => item.due);
  if (!due.length) return { skipped: 'no due follow-ups' };
  let repository = realpathSync(cwd);
  if (process.platform === 'win32') repository = repository.toLowerCase();
  const { dir, file } = sessionFile(home, `followups:${repository}:${today}`);
  try { writeFileSync(file, JSON.stringify({ date: today }), { flag: 'wx' }); }
  catch (error) {
    if (error.code === 'EEXIST') return { skipped: 'already reported' };
    throw error;
  }
  const detail = settings.lang === 'zh' ? `${due.length} 项到期跟进 (FOLLOWUPS.md)` : `${due.length} due follow-ups (FOLLOWUPS.md)`;
  const result = await sendNotice({ event: 'followups', project: basename(cwd), detail: [detail, ...due.slice(0, 3).map(followupLine)].join('\n') }, { settings, fetcher });
  if (!result.sent) rmSync(file, { force: true });
  prune(dir, now);
  return result;
}

// One notice per turn: a long turn that reported done is not reported again when the prompt sits idle.
export async function handleHook(payload, { env = process.env, home = homedir(), now = Date.now(), fetcher = fetch } = {}) {
  if (env.FF_CHILD) return { skipped: 'child process' };
  const settings = notifySettings(env, home);
  if (!notifyChannels(settings).length) return { skipped: 'not configured' };
  const name = payload?.hook_event_name;
  if (name === 'SessionStart') return notifyFollowups(payload.cwd ?? process.cwd(), { settings, home, now, fetcher });
  const { dir, file } = sessionFile(home, payload?.session_id ?? payload?.cwd ?? 'session');
  const state = readSession(file);
  if (name === 'UserPromptSubmit') {
    writeFileSync(file, JSON.stringify({ started: now }));
    prune(dir, now);
    return { skipped: 'turn started' };
  }
  const reported = state.notified && state.notified >= (state.started ?? 0);
  let notice;
  if (name === 'Stop') {
    if (payload.stop_hook_active || reported) return { skipped: 'already reported' };
    if (state.started !== undefined && now - state.started < settings.minMinutes * 60000) return { skipped: 'short turn' };
    notice = { event: 'done', detail: payload.last_assistant_message };
  } else if (name === 'StopFailure') {
    notice = { event: 'failed', detail: payload.error_details ?? payload.last_assistant_message ?? payload.error };
  } else if (name === 'Notification' && payload.notification_type === 'permission_prompt') {
    // Fires only for a dialog a person must answer, so each one counts and the turn can still report done.
    if (payload.agent_id) return { skipped: 'sub-agent' };
    return sendNotice({ event: 'permission', detail: payload.message, project: basename(payload.cwd ?? process.cwd()) }, { settings, fetcher });
  } else if (name === 'Notification' && payload.notification_type === 'idle_prompt') {
    if (reported) return { skipped: 'already reported' };
    notice = { event: 'waiting', detail: payload.message };
  } else return { skipped: 'other event' };
  writeFileSync(file, JSON.stringify({ ...state, notified: now }));
  return sendNotice({ ...notice, project: basename(payload.cwd ?? process.cwd()) }, { settings, fetcher });
}

export async function notifyRun(cwd, event, detail) {
  if (process.env.FF_CHILD) return;
  const settings = notifySettings();
  if (!notifyChannels(settings).length) return;
  await sendNotice({ event, project: basename(cwd), detail }, { settings }).catch(() => {});
}

export async function notify(args, cwd = process.cwd()) {
  const settings = notifySettings();
  const channels = notifyChannels(settings);
  if (args[0] === '--test') {
    if (!channels.length) { console.error('Notifications are off: nothing configured in ~/.ff/notify.env.'); return 1; }
    const result = await sendNotice({ event: 'test', project: basename(cwd), detail: 'ff notify --test' }, { settings });
    console.log(`Sent ${result.sent} of ${channels.length}.${result.failed.length ? ` Failed: ${result.failed.join(', ')}.` : ''}`);
    return result.failed.length ? 1 : 0;
  }
  if (args.length) { console.error('usage: ff notify [--test]'); return 2; }
  console.log(`Notifications: ${channels.length ? channels.join(', ') : 'off'}`);
  return 0;
}
