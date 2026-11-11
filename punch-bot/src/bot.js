// 打卡提醒機器人主邏輯
//
// 流程：排程時間一到 → 若當天要上班且沒請假 → Telegram 傳出帶按鈕的提醒
//       → 使用者點按鈕 → 才呼叫 Apollo 打卡 → 回報結果
// 上班時間 09:00～18:00。沒點按鈕就不會打卡；若仍未打卡會再提醒一次。

import { getDayInfo } from './calendar.js';
import { punch } from './apollo.js';
import { sendMessage, tg, punchButton } from './telegram.js';
import { taipeiNow, normalizeDate, dateRange } from './time.js';

// Cloudflare cron 以 UTC 計算；台北 = UTC+8
export const SCHEDULE = {
  '50 0 * * *': { type: 'in', retry: false }, //  08:50 上班提醒
  '57 0 * * *': { type: 'in', retry: true }, //   08:57 上班再提醒（9:00 上班前）
  '0 10 * * *': { type: 'out', retry: false }, // 18:00 下班提醒
  '10 10 * * *': { type: 'out', retry: true }, // 18:10 下班再提醒
};

const LABEL = { in: '上班', out: '下班' };
const STATE_TTL = 3 * 24 * 60 * 60;
const LEAVE_TTL = 400 * 24 * 60 * 60;

const stateKey = (date, type) => `punch:${date}:${type}`;

async function getState(env, date, type) {
  const raw = await env.KV.get(stateKey(date, type));
  return raw ? JSON.parse(raw) : null;
}

function putState(env, date, type, state) {
  return env.KV.put(stateKey(date, type), JSON.stringify(state), { expirationTtl: STATE_TTL });
}

// ───────────────────────── 排程 ─────────────────────────

export async function runSchedule(env, cron, now = new Date()) {
  const job = SCHEDULE[cron];
  if (!job) return;
  const { date } = taipeiNow(now);
  const day = await getDayInfo(env, date);
  const state = await getState(env, date, job.type);

  if (!day.workday) {
    if (job.type === 'in' && !job.retry) {
      await sendMessage(env, `😴 ${date} ${day.reason}，今天不提醒打卡。`, {
        disable_notification: true,
      });
    }
    return;
  }
  if (state?.status === 'done') return;
  if (job.retry && !state) return; // 第一次提醒沒送出（例如當時出錯），不補發

  const prefix = job.retry ? '⏰ 再提醒一次：' : '🔔 ';
  let text = `${prefix}${date} 該打${LABEL[job.type]}卡了，確認後點下方按鈕。`;
  if (day.fallback) text += '\n⚠️ 無法取得政府辦公日曆，今天暫以「週一到週五上班」判斷。';

  const msg = await sendMessage(env, text, { reply_markup: punchButton(job.type, date) });
  await putState(env, date, job.type, { status: 'pending', messageId: msg.message_id });
}

// ───────────────────────── 打卡 ─────────────────────────

async function doPunch(env, type, date, now) {
  const state = await getState(env, date, type);
  if (state?.status === 'done') {
    return { ok: false, text: `ℹ️ ${date} ${LABEL[type]}卡已經在 ${state.at} 打過了。` };
  }
  try {
    const result = await punch(env, type);
    const at = taipeiNow(now).time;
    await putState(env, date, type, { status: 'done', at, dryRun: result.dryRun });
    const note = result.dryRun ? `\n🧪 ${result.detail}` : '';
    return { ok: true, text: `✅ ${date} ${LABEL[type]}卡打卡成功（${at}）${note}` };
  } catch (err) {
    await putState(env, date, type, { ...(state || {}), status: 'failed', error: err.message });
    return { ok: false, failed: true, text: `❌ ${LABEL[type]}卡打卡失敗：${err.message}` };
  }
}

async function handleCallback(env, cq, now) {
  const [tag, type, date] = String(cq.data || '').split(':');
  if (tag !== 'p' || !LABEL[type]) return;
  const today = taipeiNow(now).date;
  const msg = cq.message;

  if (date !== today) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '這個按鈕已過期' });
    await tg(env, 'editMessageReplyMarkup', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
    return;
  }

  const r = await doPunch(env, type, date, now);
  await tg(env, 'answerCallbackQuery', {
    callback_query_id: cq.id,
    text: r.ok ? '打卡成功' : r.failed ? '打卡失敗' : '已經打過了',
  });
  await tg(env, 'editMessageText', {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    text: r.text,
    // 失敗時保留按鈕，方便再試一次
    reply_markup: r.failed ? punchButton(type, date) : { inline_keyboard: [] },
  });
}

// ───────────────────────── 指令 ─────────────────────────

const HELP = `打卡提醒機器人
上班時間 09:00～18:00。每個上班日 08:50 / 18:00 會傳提醒，點按鈕才會打卡；
沒點的話 08:57 / 18:10 會再提醒一次。
國定假日、週末、請假日不提醒，補班日會提醒。

指令：
/today — 今天狀態
/in、/out — 立即打上班／下班卡
/leave 11/20 — 登記請假（可給區間：/leave 11/20 11/22）
/cancel 11/20 — 取消請假（也可給區間）
/leaves — 列出已登記的請假`;

async function listLeaves(env, today) {
  const keys = [];
  let cursor;
  do {
    const page = await env.KV.list({ prefix: 'leave:', cursor });
    keys.push(...page.keys.map((k) => k.name.slice(6)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys.filter((d) => d >= today).sort();
}

function parseRange(args, now) {
  const from = normalizeDate(args[0], now);
  const to = args[1] ? normalizeDate(args[1], now) : from;
  if (!from || !to) throw new Error('日期格式看不懂，請用 11/20 或 2026-11-20');
  return dateRange(from, to);
}

async function handleCommand(env, text, now) {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const today = taipeiNow(now).date;

  switch (cmd) {
    case '/start':
    case '/help':
      return HELP;

    case '/today': {
      const day = await getDayInfo(env, today);
      const lines = [`📅 ${today}：${day.workday ? '上班日' : '不上班'}（${day.reason}）`];
      for (const type of ['in', 'out']) {
        const s = await getState(env, today, type);
        const status = !s
          ? '尚未提醒'
          : s.status === 'done'
            ? `已打卡 ${s.at}${s.dryRun ? '（模擬）' : ''}`
            : s.status === 'failed'
              ? `失敗：${s.error}`
              : '等待確認';
        lines.push(`${LABEL[type]}：${status}`);
      }
      return lines.join('\n');
    }

    case '/in':
    case '/out':
      return (await doPunch(env, cmd.slice(1), today, now)).text;

    case '/leave': {
      const days = parseRange(args, now);
      for (const d of days) await env.KV.put(`leave:${d}`, '1', { expirationTtl: LEAVE_TTL });
      return `🏖️ 已登記請假：${days.join('、')}\n這些日子不會提醒打卡。`;
    }

    case '/cancel': {
      const days = parseRange(args, now);
      for (const d of days) await env.KV.delete(`leave:${d}`);
      return `🗑️ 已取消請假：${days.join('、')}`;
    }

    case '/leaves': {
      const list = await listLeaves(env, today);
      return list.length ? `已登記的請假：\n${list.join('\n')}` : '目前沒有登記請假。';
    }

    default:
      return '看不懂這個指令，輸入 /help 查看用法。';
  }
}

// ───────────────────────── Webhook 入口 ─────────────────────────

export async function handleUpdate(env, update, now = new Date()) {
  const chatId = String(
    update.callback_query?.message?.chat?.id ?? update.message?.chat?.id ?? '',
  );
  if (!chatId) return;

  // 只服務設定好的那一個 chat；還沒設定時回傳 chat id 方便設定
  if (!env.TELEGRAM_CHAT_ID) {
    if (update.message) {
      await tg(env, 'sendMessage', {
        chat_id: chatId,
        text: `你的 chat id 是 ${chatId}\n請設定為 TELEGRAM_CHAT_ID secret 後重新部署。`,
      });
    }
    return;
  }
  if (chatId !== String(env.TELEGRAM_CHAT_ID)) return;

  if (update.callback_query) return handleCallback(env, update.callback_query, now);

  const text = update.message?.text;
  if (!text?.startsWith('/')) return;
  let reply;
  try {
    reply = await handleCommand(env, text, now);
  } catch (err) {
    reply = `⚠️ ${err.message}`;
  }
  await sendMessage(env, reply);
}
