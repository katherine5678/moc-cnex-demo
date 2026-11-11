// 台北時間（UTC+8，無日光節約）工具

const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 取得台北時間的日期、時間等資訊 */
export function taipeiNow(now = new Date()) {
  const t = new Date(now.getTime() + OFFSET_MS);
  const iso = t.toISOString();
  return {
    date: iso.slice(0, 10), // YYYY-MM-DD
    time: iso.slice(11, 19), // HH:MM:SS
    year: t.getUTCFullYear(),
    weekday: t.getUTCDay(), // 0=日 ... 6=六
  };
}

/** 檢查是否為合法的 YYYY-MM-DD 日期 */
export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 星期幾（0=日），以日期字串計算 */
export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 列出 from ~ to（含）之間所有日期，最多 maxDays 天 */
export function dateRange(from, to, maxDays = 60) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (end < start) throw new Error('結束日期不能早於開始日期');
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > maxDays) throw new Error(`一次最多登記 ${maxDays} 天`);
  return Array.from({ length: days }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

/** 支援 YYYY-MM-DD、YYYY/MM/DD、MM/DD、MM-DD（後兩者以今年補上年份） */
export function normalizeDate(input, now = new Date()) {
  const s = String(input || '').trim().replace(/\//g, '-');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let out;
  if (m) out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  else if ((m = s.match(/^(\d{1,2})-(\d{1,2})$/))) {
    out = `${taipeiNow(now).year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return out && isValidDate(out) ? out : null;
}
