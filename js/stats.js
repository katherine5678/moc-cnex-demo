/**
 * @typedef {import('./storage.js').Record} Record
 */

export const ALL_YEARS = "all";

/**
 * @param {string} isoOrDate
 */
export function yearOf(isoOrDate) {
  if (!isoOrDate) return "未標日期";
  const y = isoOrDate.slice(0, 4);
  if (/^\d{4}$/.test(y)) return y;
  try {
    const dt = new Date(isoOrDate);
    if (!Number.isNaN(dt.getTime())) return String(dt.getFullYear());
  } catch {
    /* ignore */
  }
  return "未標日期";
}

/**
 * 可切換的年份列表（所有年份 + 資料中出現的年 + 今年）
 * @param {Record[]} records
 */
export function listStatYears(records) {
  const years = new Set();
  const current = String(new Date().getFullYear());
  years.add(current);
  for (const r of records) {
    const y = yearOf(r.joinedAt || r.createdAt);
    if (y !== "未標日期") years.add(y);
  }
  return [ALL_YEARS, ...[...years].sort((a, b) => b.localeCompare(a))];
}

/**
 * @param {string} year
 */
export function isAllYears(year) {
  return year === ALL_YEARS || year === "所有年份";
}

/**
 * @param {string} year
 */
export function formatYearLabel(year) {
  return isAllYears(year) ? "所有年份" : `${year} 年`;
}

/**
 * @param {Record[]} records
 * @param {string} year
 */
export function computeStats(records, year) {
  const scoped = isAllYears(year)
    ? [...records]
    : records.filter((r) => yearOf(r.joinedAt || r.createdAt) === year);

  const totalCases = scoped.length;
  const totalPeople = scoped.reduce((sum, r) => sum + (r.members?.length || 0), 0);
  const withRoster = scoped.filter((r) => (r.members?.length || 0) > 0).length;

  const units = new Set(scoped.map((r) => r.inviteUnit).filter(Boolean));

  const cases = [...scoped].sort((a, b) =>
    (b.joinedAt || b.createdAt || "").localeCompare(a.joinedAt || a.createdAt || "")
  );

  return {
    year,
    totalCases,
    totalPeople,
    withRoster,
    unitCount: units.size,
    cases,
  };
}
