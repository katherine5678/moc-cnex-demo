import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleUpdate, runSchedule } from '../src/bot.js';
import { parseCalendar } from '../src/calendar.js';
import { normalizeDate, dateRange, taipeiNow } from '../src/time.js';

// ── 測試替身 ──
function memoryKV() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

// 2026 年部分日曆（ruyut/TaiwanCalendar 格式）
const CAL_2026 = [
  { date: '20260101', week: '四', isHoliday: true, description: '開國紀念日' },
  { date: '20260102', week: '五', isHoliday: false, description: '' },
  { date: '20260103', week: '六', isHoliday: true, description: '' },
  { date: '20260110', week: '六', isHoliday: false, description: '補行上班' },
];

let env, calls, originalFetch;
beforeEach(() => {
  env = { KV: memoryKV(), TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '42', APOLLO_DRY_RUN: 'true' };
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('TaiwanCalendar')) return new Response(JSON.stringify(CAL_2026));
    const method = url.split('/').pop();
    const body = JSON.parse(init.body);
    calls.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }));
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

// 台北時間 → Date
const at = (s) => new Date(`${s}+08:00`);
const sent = () => calls.filter((c) => c.method === 'sendMessage');

test('上班日 08:50 傳出帶按鈕的提醒，但不打卡', async () => {
  await runSchedule(env, '50 0 * * *', at('2026-01-02T08:50:00'));
  assert.equal(sent().length, 1);
  assert.equal(sent()[0].body.reply_markup.inline_keyboard[0][0].callback_data, 'p:in:2026-01-02');
  assert.equal(JSON.parse(env.KV.m.get('punch:2026-01-02:in')).status, 'pending');
});

test('國定假日、週末不提醒；補班的週六會提醒', async () => {
  await runSchedule(env, '50 0 * * *', at('2026-01-01T08:50:00'));
  assert.match(sent()[0].body.text, /開國紀念日，今天不提醒/);
  assert.equal(sent()[0].body.reply_markup, undefined);

  await runSchedule(env, '0 10 * * *', at('2026-01-03T18:00:00'));
  assert.equal(sent().length, 1, '週六下班不提醒也不發訊息');

  await runSchedule(env, '50 0 * * *', at('2026-01-10T08:50:00'));
  assert.ok(sent()[1].body.reply_markup, '補班日要提醒');
});

test('請假日不提醒', async () => {
  await handleUpdate(env, { message: { chat: { id: 42 }, text: '/leave 2026/1/2' } }, at('2026-01-01T12:00:00'));
  calls = [];
  await runSchedule(env, '50 0 * * *', at('2026-01-02T08:50:00'));
  assert.match(sent()[0].body.text, /請假/);
  assert.equal(sent()[0].body.reply_markup, undefined);
});

test('點按鈕才打卡；已打卡就不再提醒', async () => {
  await runSchedule(env, '50 0 * * *', at('2026-01-02T08:50:00'));
  await handleUpdate(env, {
    callback_query: { id: 'c1', data: 'p:in:2026-01-02', message: { message_id: 7, chat: { id: 42 } } },
  }, at('2026-01-02T08:52:10'));
  const edit = calls.find((c) => c.method === 'editMessageText');
  assert.match(edit.body.text, /上班卡打卡成功（08:52:10）/);
  assert.equal(JSON.parse(env.KV.m.get('punch:2026-01-02:in')).status, 'done');

  calls = [];
  await runSchedule(env, '57 0 * * *', at('2026-01-02T08:57:00'));
  assert.equal(sent().length, 0);
});

test('沒點按鈕會再提醒一次', async () => {
  await runSchedule(env, '0 10 * * *', at('2026-01-02T18:00:00'));
  await runSchedule(env, '10 10 * * *', at('2026-01-02T18:10:00'));
  assert.equal(sent().length, 2);
  assert.match(sent()[1].body.text, /再提醒一次/);
});

test('過期的按鈕不會打卡', async () => {
  await handleUpdate(env, {
    callback_query: { id: 'c1', data: 'p:in:2026-01-02', message: { message_id: 7, chat: { id: 42 } } },
  }, at('2026-01-05T08:52:00'));
  assert.equal(env.KV.m.get('punch:2026-01-02:in'), undefined);
  assert.equal(env.KV.m.get('punch:2026-01-05:in'), undefined);
  assert.equal(calls.find((c) => c.method === 'answerCallbackQuery').body.text, '這個按鈕已過期');
});

test('Apollo 失敗時回報錯誤並保留按鈕', async () => {
  env.APOLLO_DRY_RUN = 'false';
  await handleUpdate(env, {
    callback_query: { id: 'c1', data: 'p:out:2026-01-02', message: { message_id: 7, chat: { id: 42 } } },
  }, at('2026-01-02T18:01:00'));
  const edit = calls.find((c) => c.method === 'editMessageText');
  assert.match(edit.body.text, /下班卡打卡失敗/);
  assert.ok(edit.body.reply_markup.inline_keyboard[0][0]);
});

test('其他 chat 的訊息一律忽略', async () => {
  await handleUpdate(env, { message: { chat: { id: 999 }, text: '/in' } }, at('2026-01-02T08:50:00'));
  assert.equal(calls.length, 0);
});

test('日曆抓不到時退回週一到週五並提醒', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('TaiwanCalendar')) return new Response('nope', { status: 500 });
    calls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  };
  await runSchedule(env, '50 0 * * *', at('2026-03-02T08:50:00')); // 週一
  assert.match(sent()[0].body.text, /無法取得政府辦公日曆/);
});

test('/leave 區間、/leaves、/cancel', async () => {
  const now = at('2026-11-11T12:00:00');
  await handleUpdate(env, { message: { chat: { id: 42 }, text: '/leave 11/20 11/22' } }, now);
  await handleUpdate(env, { message: { chat: { id: 42 }, text: '/cancel 11/21' } }, now);
  await handleUpdate(env, { message: { chat: { id: 42 }, text: '/leaves' } }, now);
  assert.equal(sent().at(-1).body.text, '已登記的請假：\n2026-11-20\n2026-11-22');
});

test('工具函式', () => {
  assert.equal(normalizeDate('11/5', at('2026-01-01T00:00:00')), '2026-11-05');
  assert.equal(normalizeDate('2026-02-30'), null);
  assert.deepEqual(dateRange('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  assert.equal(taipeiNow(new Date('2026-01-01T16:30:00Z')).date, '2026-01-02');
  assert.deepEqual(parseCalendar(CAL_2026)['2026-01-10'], { off: false, desc: '補行上班' });
});
