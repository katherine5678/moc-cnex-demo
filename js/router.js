/**
 * Hash 路由：可分享網址
 * #/records
 * #/records/2026
 * #/records/all
 * #/stats…（相容舊網址，導向 records）
 * #/unit/<邀請單位>
 * #/case/<團號>
 */

let suppressHashSync = false;

/** @returns {{ name: string, year?: string, unit?: string, groupNo?: string }} */
export function parseHash(hash = location.hash) {
  const raw = (hash || "").replace(/^#/, "").replace(/^\/+/, "");
  const parts = raw
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });

  const [head = ""] = parts;
  const parseYear = (year) => {
    if (year === "all" || year === "所有年份") return "all";
    if (year && /^\d{4}$/.test(year)) return year;
    return undefined;
  };

  if (!head || head === "records") {
    const year = parseYear(parts[1]);
    return year ? { name: "records", year } : { name: "records" };
  }
  // 舊統計網址 → 首頁＋年份
  if (head === "stats") {
    const year = parseYear(parts[1]);
    return year ? { name: "records", year } : { name: "records" };
  }
  if (head === "unit") {
    const unit = parts.slice(1).join("/");
    if (unit) return { name: "company", unit };
    return { name: "records" };
  }
  if (head === "case" || head === "detail") {
    const groupNo = parts.slice(1).join("/");
    if (groupNo) return { name: "detail", groupNo };
    return { name: "records" };
  }
  return { name: "records" };
}

/**
 * @param {{ name: string, year?: string, unit?: string, groupNo?: string, id?: string }} state
 */
export function buildHash(state) {
  if (state.name === "company" && state.unit) {
    return `#/unit/${encodeURIComponent(state.unit)}`;
  }
  if (state.name === "detail") {
    const key = state.groupNo || state.id;
    if (key) return `#/case/${encodeURIComponent(key)}`;
  }
  if (state.year) {
    return `#/records/${encodeURIComponent(state.year)}`;
  }
  return "#/records";
}

/** @param {string} hash */
export function setHash(hash, { replace = false } = {}) {
  const next = hash.startsWith("#") ? hash : `#${hash}`;
  if (location.hash === next) return;
  suppressHashSync = true;
  if (replace) {
    history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
    suppressHashSync = false;
  } else {
    location.hash = next;
  }
}

export function isHashSyncSuppressed() {
  return suppressHashSync;
}

/**
 * @param {(route: ReturnType<typeof parseHash>) => void} handler
 */
export function startRouter(handler) {
  window.addEventListener("hashchange", () => {
    if (suppressHashSync) {
      suppressHashSync = false;
      return;
    }
    handler(parseHash());
  });
  if (!location.hash || location.hash === "#") {
    setHash("#/records", { replace: true });
  }
  handler(parseHash());
}
