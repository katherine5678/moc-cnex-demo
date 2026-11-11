// 上班日判斷：國定假日、補班日（行政院人事行政總處辦公日曆）＋ 個人請假

import { weekdayOf } from './time.js';

// 預設資料來源：ruyut/TaiwanCalendar（整理自政府資料開放平台「辦公日曆表」）
// 格式：[{ "date": "20260101", "week": "四", "isHoliday": true, "description": "開國紀念日" }, ...]
export const DEFAULT_CALENDAR_URL =
  'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json';

const CACHE_TTL = 7 * 24 * 60 * 60; // 秒

/** 把原始 JSON 轉成 { 'YYYY-MM-DD': { off: boolean, desc: string } } */
export function parseCalendar(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('日曆資料格式不正確');
  const map = {};
  for (const r of rows) {
    const raw = String(r.date ?? r['西元日期'] ?? '');
    const m = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (!m) continue;
    const off = r.isHoliday ?? (r['是否放假'] === '2' || r['是否放假'] === 2);
    map[`${m[1]}-${m[2]}-${m[3]}`] = {
      off: off === true || off === 'true',
      desc: String(r.description ?? r['備註'] ?? '').trim(),
    };
  }
  if (Object.keys(map).length === 0) throw new Error('日曆資料沒有可用的日期');
  return map;
}

/** 取得某一年的日曆（KV 快取 7 天）；抓不到時回傳 null */
export async function getYearCalendar(env, year) {
  const key = `cal:${year}`;
  const cached = await env.KV.get(key);
  if (cached) return JSON.parse(cached);
  const url = (env.CALENDAR_URL || DEFAULT_CALENDAR_URL).replace('{year}', year);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = parseCalendar(await res.json());
    await env.KV.put(key, JSON.stringify(map), { expirationTtl: CACHE_TTL });
    return map;
  } catch (err) {
    console.warn(`無法取得 ${year} 年日曆：${err.message}`);
    return null;
  }
}

/**
 * 判斷某天要不要上班
 * @returns {{ workday: boolean, reason: string, fallback: boolean }}
 */
export async function getDayInfo(env, date) {
  if (await env.KV.get(`leave:${date}`)) {
    return { workday: false, reason: '請假', fallback: false };
  }
  const cal = await getYearCalendar(env, date.slice(0, 4));
  const entry = cal?.[date];
  if (entry) {
    if (entry.off) return { workday: false, reason: entry.desc || '放假日', fallback: false };
    return { workday: true, reason: entry.desc || '上班日', fallback: false };
  }
  // 日曆抓不到：退回「週一到週五上班」
  const wd = weekdayOf(date);
  const weekend = wd === 0 || wd === 6;
  return { workday: !weekend, reason: weekend ? '週末' : '平日', fallback: true };
}
