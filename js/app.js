import { loadRecords, saveRecords, createRecord, uid } from "./storage.js";
import {
  parseImmigrationNotice,
  parseRosterText,
  extractPdfText,
} from "./parsers.js";
import { listStatYears, formatYearLabel, isAllYears, ALL_YEARS, yearOf } from "./stats.js";
import seedRecords from "./seed-data.js";
import { buildHash, setHash, startRouter, isHashSyncSuppressed } from "./router.js";

/** @type {import('./storage.js').Record[]} */
let records = loadRecords();
if (!records.length) {
  records = structuredClone(seedRecords);
  saveRecords(records);
}
/** @type {string | null} */
let editingId = null;
/** @type {string | null} */
let detailId = null;
/** @type {{ seq: number, name: string, gender: string, org: string, title: string, id?: string }[]} */
let draftMembers = [];
/** @type {string} */
let statsYear = ALL_YEARS;
/** @type {string | null} */
let companyUnit = null;
/** @type {string} */
let detailBackView = "records";
/** @type {Set<string>} */
const expandedRows = new Set();
/** @type {boolean} */
let routeReady = false;

const $ = (sel) => document.querySelector(sel);

const els = {
  search: $("#search-input"),
  tbody: $("#records-tbody"),
  empty: $("#records-empty"),
  dialog: /** @type {HTMLDialogElement} */ ($("#record-dialog")),
  form: /** @type {HTMLFormElement} */ ($("#record-form")),
  dialogTitle: $("#dialog-title"),
  pasteText: /** @type {HTMLTextAreaElement} */ ($("#paste-text")),
  parseHint: $("#parse-hint"),
  membersTbody: $("#members-tbody"),
  btnDelete: $("#btn-delete-record"),
  statsYear: /** @type {HTMLSelectElement} */ ($("#stats-year")),
  statsSummary: $("#stats-summary"),
  companyName: $("#company-name"),
  companySub: $("#company-sub"),
  companySummary: $("#company-summary"),
  companyTbody: $("#company-tbody"),
  companyEmpty: $("#company-empty"),
  detailTitle: $("#detail-title"),
  detailSub: $("#detail-sub"),
  detailBody: $("#detail-body"),
};

function persist() {
  saveRecords(records);
  render();
}

function render() {
  const years = listStatYears(records);
  if (!years.includes(statsYear)) {
    statsYear = ALL_YEARS;
  }

  els.statsYear.innerHTML = years
    .map((y) => {
      const label = isAllYears(y) ? "所有年份" : `${y} 年`;
      return `<option value="${escapeAttr(y)}" ${y === statsYear ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");

  const yearLabel = formatYearLabel(statsYear);
  const q = (els.search.value || "").trim().toLowerCase();
  let filtered = isAllYears(statsYear)
    ? [...records]
    : records.filter((r) => yearOf(r.joinedAt || r.createdAt) === statsYear);

  if (q) {
    filtered = filtered.filter((r) => {
      const memberFields = (r.members || []).flatMap((m) => [
        m.name,
        m.org,
        m.title,
        m.gender,
      ]);
      const hay = [
        r.groupNo,
        r.inviteUnit,
        r.receiptNo,
        r.applicantName,
        r.purpose,
        r.notes,
        ...memberFields,
      ]
        .join(" ")
        .toLowerCase();
      const hit = hay.includes(q);
      if (hit) {
        const memberHit = memberFields.some((f) =>
          String(f || "")
            .toLowerCase()
            .includes(q)
        );
        if (memberHit) expandedRows.add(r.id);
      }
      return hit;
    });
  }

  filtered.sort((a, b) => (b.joinedAt || b.createdAt).localeCompare(a.joinedAt || a.createdAt));

  const totalPeople = filtered.reduce((sum, r) => sum + (r.members?.length || 0), 0);
  const unitCount = new Set(filtered.map((r) => r.inviteUnit).filter(Boolean)).size;
  els.statsSummary.innerHTML = [
    ["案件數", filtered.length],
    ["交流人員", totalPeople],
    ["邀請單位", unitCount],
  ]
    .map(
      ([label, val]) => `
    <div class="stat-card">
      <p class="stat-label">${escapeHtml(label)}</p>
      <p class="stat-value">${val}</p>
    </div>`
    )
    .join("");

  const showEmpty = filtered.length === 0;
  els.empty.classList.toggle("hidden", !showEmpty);
  if (showEmpty) {
    $("#empty-title").textContent = q
      ? "沒有符合的案件"
      : isAllYears(statsYear)
        ? "尚無交流案件"
        : `${yearLabel}尚無案件`;
    $("#empty-sub").textContent = q
      ? "請調整搜尋關鍵字"
      : "可貼上移民署通知信，或手動新增。";
    $("#btn-empty-new").classList.toggle("hidden", !!q);
  }
  document.querySelector("#view-records .table-wrap")?.classList.toggle("hidden", showEmpty);

  els.tbody.innerHTML = filtered
    .map((r) => {
      const open = expandedRows.has(r.id);
      const members = r.members || [];
      const membersBlock =
        members.length > 0
          ? `<div class="nested-roster" role="table" aria-label="交流人員清單">
              <div class="nested-roster-head" role="row">
                <span role="columnheader">編號</span>
                <span role="columnheader">姓名</span>
                <span role="columnheader">性別</span>
                <span role="columnheader">現任職單位</span>
                <span role="columnheader">職稱</span>
              </div>
              ${members
                .map(
                  (m) => `<div class="nested-roster-row" role="row">
                <span role="cell">${m.seq}</span>
                <span role="cell">${highlightText(m.name, q)}</span>
                <span role="cell">${highlightText(m.gender || "—", q)}</span>
                <span role="cell">${highlightText(m.org || "—", q)}</span>
                <span role="cell">${highlightText(m.title || "—", q)}</span>
              </div>`
                )
                .join("")}
            </div>`
          : `<p class="muted nested-empty">尚無交流人員名冊</p>`;

      return `
    <tr data-id="${escapeAttr(r.id)}" class="record-row${open ? " is-expanded" : ""}">
      <td class="col-expand">
        <button type="button" class="expand-btn${open ? " is-open" : ""}" data-action="toggle" aria-expanded="${open}" aria-label="${open ? "收合人員清單" : "展開人員清單"}">
          <svg class="expand-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
            <path d="M6.5 9.5L12 15l5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </td>
      <td class="mono"><button type="button" class="group-link" data-action="view">${highlightText(r.groupNo, q)}</button></td>
      <td>${unitLink(r.inviteUnit, q)}</td>
      <td class="mono">${highlightText(r.receiptNo || "—", q)}</td>
      <td>${highlightText(r.applicantName, q)}</td>
      <td class="col-count">${members.length}</td>
      <td>${escapeHtml(formatDate(r.joinedAt) || "—")}</td>
      <td class="actions">
        <button type="button" class="link-btn" data-action="view">詳情</button>
        <button type="button" class="link-btn" data-action="edit">編輯</button>
        <button type="button" class="link-btn danger" data-action="delete">刪除</button>
      </td>
    </tr>
    <tr class="members-panel${open ? " is-open" : ""}" data-parent="${escapeAttr(r.id)}" ${open ? "" : "hidden"}>
      <td colspan="8"><div class="members-panel-inner">${membersBlock}</div></td>
    </tr>`;
    })
    .join("");

  if (companyUnit) renderCompany();
  if (detailId) renderDetail();
}

function unitLink(name, q = "") {
  if (!name) return "—";
  return `<button type="button" class="unit-link" data-unit="${escapeAttr(name)}">${highlightText(name, q)}</button>`;
}

function syncRoute({ replace = false } = {}) {
  if (!routeReady || isHashSyncSuppressed()) return;
  const active = document.querySelector(".view.is-active")?.id || "";
  if (active === "view-detail" && detailId) {
    const r = records.find((x) => x.id === detailId);
    setHash(buildHash({ name: "detail", groupNo: r?.groupNo || detailId }), { replace });
    return;
  }
  if (active === "view-company" && companyUnit) {
    setHash(buildHash({ name: "company", unit: companyUnit }), { replace });
    return;
  }
  setHash(buildHash({ name: "records", year: statsYear }), { replace });
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => {
    const active = v.id === `view-${name}`;
    v.classList.toggle("is-active", active);
    v.hidden = !active;
  });
}

function openCompany(unit, { fromRoute = false } = {}) {
  if (!unit) return;
  companyUnit = unit;
  if (!fromRoute) detailBackView = "records";
  detailId = null;
  showView("company");
  renderCompany();
  if (!fromRoute) syncRoute();
}

function openDetail(id, { fromRoute = false } = {}) {
  const r = records.find((x) => x.id === id);
  if (!r) return;

  if (!fromRoute) {
    const active = document.querySelector(".view.is-active")?.id || "";
    if (active === "view-company") detailBackView = "company";
    else if (active !== "view-detail") detailBackView = "records";
  }

  detailId = id;
  showView("detail");
  updateDetailBackLabel();
  renderDetail();
  if (!fromRoute) syncRoute();
}

function openDetailByGroupNo(groupNo, { fromRoute = false } = {}) {
  const r =
    records.find((x) => x.groupNo === groupNo) ||
    records.find((x) => x.id === groupNo);
  if (!r) {
    showView("records");
    if (!fromRoute) syncRoute({ replace: true });
    return;
  }
  openDetail(r.id, { fromRoute });
}

function switchView(name, { fromRoute = false } = {}) {
  if (name !== "company" && name !== "detail") companyUnit = null;
  if (name !== "detail") detailId = null;
  if (name === "stats") name = "records";
  showView(name);
  if (name === "company" && companyUnit) renderCompany();
  if (name === "detail" && detailId) renderDetail();
  if (!fromRoute) syncRoute();
}

function backFromDetail() {
  if (detailBackView === "company" && companyUnit) {
    detailId = null;
    showView("company");
    renderCompany();
    syncRoute();
    return;
  }
  switchView("records");
}

function applyRoute(route) {
  if (route.name === "detail" && route.groupNo) {
    detailBackView = "records";
    openDetailByGroupNo(route.groupNo, { fromRoute: true });
    return;
  }
  if (route.name === "company" && route.unit) {
    detailId = null;
    openCompany(route.unit, { fromRoute: true });
    return;
  }
  companyUnit = null;
  detailId = null;
  if (route.year) statsYear = route.year;
  showView("records");
}

function renderCompany() {
  if (!companyUnit) return;
  const list = records
    .filter((r) => r.inviteUnit === companyUnit)
    .sort((a, b) => (b.joinedAt || b.createdAt).localeCompare(a.joinedAt || a.createdAt));

  const people = list.reduce((sum, r) => sum + (r.members?.length || 0), 0);
  const years = [
    ...new Set(
      list
        .map((r) => (r.joinedAt || r.createdAt || "").slice(0, 4))
        .filter((y) => /^\d{4}$/.test(y))
    ),
  ].sort();

  els.companyName.textContent = companyUnit;
  els.companySub.textContent = years.length
    ? `申請期間 ${years[0]}${years.length > 1 ? `–${years[years.length - 1]}` : ""}`
    : "尚無標示日期的申請";

  els.companySummary.innerHTML = [
    ["申請案件", list.length],
    ["交流人員", people],
    ["涵蓋年份", years.length || "—"],
  ]
    .map(
      ([label, val]) => `
    <div class="stat-card">
      <p class="stat-label">${label}</p>
      <p class="stat-value">${val}</p>
    </div>`
    )
    .join("");

  const empty = list.length === 0;
  els.companyEmpty.classList.toggle("hidden", !empty);
  document.querySelector("#view-company .table-wrap")?.classList.toggle("hidden", empty);

  els.companyTbody.innerHTML = list
    .map(
      (r) => `
    <tr data-id="${escapeAttr(r.id)}">
      <td class="mono"><button type="button" class="group-link" data-action="view">${escapeHtml(r.groupNo)}</button></td>
      <td class="mono">${escapeHtml(r.receiptNo || "—")}</td>
      <td>${escapeHtml(r.applicantName)}</td>
      <td>${r.members?.length || 0}</td>
      <td>${escapeHtml(formatDate(r.joinedAt) || "—")}</td>
      <td>${escapeHtml(r.purpose || "—")}</td>
      <td class="actions">
        <button type="button" class="link-btn" data-action="view">詳情</button>
        <button type="button" class="link-btn" data-action="edit">編輯</button>
        <button type="button" class="link-btn danger" data-action="delete">刪除</button>
      </td>
    </tr>`
    )
    .join("");
}

function openDialog(record) {
  editingId = record?.id || null;
  els.dialogTitle.textContent = editingId ? "編輯案件" : "新增案件";
  els.btnDelete.classList.toggle("hidden", !editingId);
  els.pasteText.value = "";
  els.parseHint.textContent = "";

  $("#field-groupNo").value = record?.groupNo || "";
  $("#field-receiptNo").value = record?.receiptNo || "";
  $("#field-inviteUnit").value = record?.inviteUnit || "";
  $("#field-applicantName").value = record?.applicantName || "";
  $("#field-purpose").value = record?.purpose || "";
  $("#field-joinedAt").value = record?.joinedAt || "";
  $("#field-notes").value = record?.notes || "";

  draftMembers = (record?.members || []).map((m) => ({ ...m, id: m.id || uid() }));
  if (!draftMembers.length) draftMembers = [];
  renderMembers();
  els.dialog.showModal();
  requestAnimationFrame(() => {
    els.dialog.querySelector(".modal-body")?.scrollTo(0, 0);
  });
}

function renderMembers() {
  if (!draftMembers.length) {
    els.membersTbody.innerHTML = `<tr class="empty-row"><td colspan="6">尚無人員，可匯入 PDF 或手動新增</td></tr>`;
    return;
  }
  els.membersTbody.innerHTML = draftMembers
    .map(
      (m, i) => `
    <tr data-mid="${escapeAttr(m.id)}">
      <td><input class="m-seq" type="number" min="1" value="${m.seq || i + 1}" /></td>
      <td><input class="m-name" value="${escapeAttr(m.name || "")}" /></td>
      <td>
        <select class="m-gender">
          <option value="" ${!m.gender ? "selected" : ""}>—</option>
          <option value="男" ${m.gender === "男" ? "selected" : ""}>男</option>
          <option value="女" ${m.gender === "女" ? "selected" : ""}>女</option>
        </select>
      </td>
      <td><input class="m-org" value="${escapeAttr(m.org || "")}" /></td>
      <td><input class="m-title" value="${escapeAttr(m.title || "")}" /></td>
      <td><button type="button" class="icon-btn sm" data-remove="${escapeAttr(m.id)}" aria-label="移除">×</button></td>
    </tr>`
    )
    .join("");
}

function collectMembersFromDom() {
  const rows = [...els.membersTbody.querySelectorAll("tr[data-mid]")];
  return rows.map((tr, i) => ({
    id: tr.getAttribute("data-mid") || uid(),
    seq: Number(tr.querySelector(".m-seq")?.value) || i + 1,
    name: tr.querySelector(".m-name")?.value?.trim() || "",
    gender: tr.querySelector(".m-gender")?.value || "",
    org: tr.querySelector(".m-org")?.value?.trim() || "",
    title: tr.querySelector(".m-title")?.value?.trim() || "",
  }));
}

function renderDetail() {
  const r = records.find((x) => x.id === detailId);
  if (!r) {
    detailId = null;
    if (detailBackView === "company" && companyUnit) {
      showView("company");
      renderCompany();
      syncRoute({ replace: true });
    } else {
      switchView("records");
    }
    return;
  }

  els.detailTitle.textContent = `團號 ${r.groupNo}`;
  els.detailSub.textContent = [r.inviteUnit, r.applicantName].filter(Boolean).join(" · ");

  const membersHtml = (r.members || []).length
    ? `<div class="members-table-wrap">
        <table class="members-table readonly">
          <thead><tr><th>#</th><th>姓名</th><th>性別</th><th>現任職單位</th><th>職稱</th></tr></thead>
          <tbody>
            ${r.members
              .map(
                (m) => `<tr>
              <td>${m.seq}</td>
              <td>${escapeHtml(m.name)}</td>
              <td>${escapeHtml(m.gender || "—")}</td>
              <td>${escapeHtml(m.org || "—")}</td>
              <td>${escapeHtml(m.title || "—")}</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<p class="muted">尚未匯入交流人員名冊</p>`;

  els.detailBody.innerHTML = `
    <dl class="detail-dl">
      <div><dt>邀請單位</dt><dd>${unitLink(r.inviteUnit)}</dd></div>
      <div><dt>收件號</dt><dd class="mono">${escapeHtml(r.receiptNo || "—")}</dd></div>
      <div><dt>申請人</dt><dd>${escapeHtml(r.applicantName)}</dd></div>
      <div><dt>申請事由</dt><dd>${escapeHtml(r.purpose || "—")}</dd></div>
      <div><dt>加入日期</dt><dd>${escapeHtml(formatDate(r.joinedAt) || "—")}</dd></div>
      <div><dt>備註</dt><dd>${escapeHtml(r.notes || "—")}</dd></div>
    </dl>
    <h3 class="detail-members-title">交流人員（${r.members?.length || 0}）</h3>
    ${membersHtml}
  `;
}

function deleteRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`確定刪除團號 ${r.groupNo}（${r.applicantName}）？`)) return;
  const wasDetail = detailId === id;
  records = records.filter((x) => x.id !== id);
  if (wasDetail) {
    detailId = null;
    persist();
    if (detailBackView === "company" && companyUnit) {
      showView("company");
      renderCompany();
      syncRoute();
    } else {
      switchView("records");
    }
    return;
  }
  persist();
}

function updateDetailBackLabel() {
  const btn = $("#btn-detail-back");
  if (!btn) return;
  const label =
    detailBackView === "company" ? "← 返回邀請單位" : "← 返回案件紀錄";
  btn.textContent = label;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 將符合關鍵字的片段標成黃色底 */
function highlightText(text, q) {
  const raw = String(text ?? "");
  const needle = (q || "").trim();
  if (!needle) return escapeHtml(raw);
  try {
    const re = new RegExp(escapeRegExp(needle), "gi");
    let out = "";
    let last = 0;
    for (const m of raw.matchAll(re)) {
      out += escapeHtml(raw.slice(last, m.index));
      out += `<mark class="search-hit">${escapeHtml(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    out += escapeHtml(raw.slice(last));
    return out;
  } catch {
    return escapeHtml(raw);
  }
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function formatDate(d) {
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-");
    return `${y}/${m}/${day}`;
  }
  return d;
}

function applyParsedNotice(data) {
  if (data.groupNo) $("#field-groupNo").value = data.groupNo;
  if (data.inviteUnit) $("#field-inviteUnit").value = data.inviteUnit;
  if (data.receiptNo) $("#field-receiptNo").value = data.receiptNo;
  if (data.applicantName) $("#field-applicantName").value = data.applicantName;
  if (data.purpose) $("#field-purpose").value = data.purpose;
  if (data.joinedAt) $("#field-joinedAt").value = data.joinedAt;

  // 若通知信有人數但尚無名冊，預留空列
  if (data.peopleCount && !draftMembers.length) {
    draftMembers = Array.from({ length: data.peopleCount }, (_, i) => ({
      id: uid(),
      seq: i + 1,
      name: i === 0 && data.applicantName ? data.applicantName : "",
      gender: "",
      org: "",
      title: "",
    }));
    renderMembers();
  }
}

// —— events ——
$("#btn-company-back").addEventListener("click", () => switchView("records"));
$("#btn-detail-back").addEventListener("click", () => backFromDetail());

document.body.addEventListener("click", (e) => {
  const unitBtn = e.target.closest("[data-unit]");
  if (!unitBtn) return;
  e.preventDefault();
  e.stopPropagation();
  const unit = unitBtn.getAttribute("data-unit");
  openCompany(unit);
});

$("#btn-new").addEventListener("click", () => openDialog(null));
$("#btn-empty-new").addEventListener("click", () => openDialog(null));
$("#btn-close-dialog").addEventListener("click", () => els.dialog.close());
$("#btn-cancel").addEventListener("click", () => els.dialog.close());

$("#btn-edit-from-detail").addEventListener("click", () => {
  const id = detailId;
  if (!id) return;
  const r = records.find((x) => x.id === id);
  if (r) openDialog(r);
});

$("#btn-delete-from-detail").addEventListener("click", () => {
  if (detailId) deleteRecord(detailId);
});

els.search.addEventListener("input", render);

els.statsYear.addEventListener("change", () => {
  statsYear = els.statsYear.value;
  render();
  syncRoute();
});

els.tbody.addEventListener("click", (e) => {
  if (e.target.closest("[data-unit]")) return;
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const tr = btn.closest("tr[data-id]");
  const id = tr?.dataset.id;
  if (!id) return;
  const action = btn.dataset.action;
  if (action === "toggle") {
    if (expandedRows.has(id)) expandedRows.delete(id);
    else expandedRows.add(id);
    render();
    return;
  }
  if (action === "view") openDetail(id);
  if (action === "edit") {
    const r = records.find((x) => x.id === id);
    if (r) openDialog(r);
  }
  if (action === "delete") deleteRecord(id);
});

els.companyTbody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const tr = btn.closest("tr[data-id]");
  const id = tr?.dataset.id;
  if (!id) return;
  const action = btn.dataset.action;
  if (action === "view") openDetail(id);
  if (action === "edit") {
    const r = records.find((x) => x.id === id);
    if (r) openDialog(r);
  }
  if (action === "delete") deleteRecord(id);
});

$("#btn-parse-paste").addEventListener("click", () => {
  const result = parseImmigrationNotice(els.pasteText.value);
  if (!result.ok) {
    els.parseHint.textContent = result.error;
    els.parseHint.classList.add("is-error");
    return;
  }
  applyParsedNotice(result.data);
  els.parseHint.classList.remove("is-error");
  const bits = [
    result.data.groupNo && `團號 ${result.data.groupNo}`,
    result.data.inviteUnit,
    result.data.applicantName,
  ].filter(Boolean);
  els.parseHint.textContent = `已解析：${bits.join(" · ")}`;
});

$("#btn-add-member").addEventListener("click", () => {
  draftMembers = collectMembersFromDom();
  draftMembers.push({
    id: uid(),
    seq: draftMembers.length + 1,
    name: "",
    gender: "",
    org: "",
    title: "",
  });
  renderMembers();
});

els.membersTbody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn) return;
  draftMembers = collectMembersFromDom().filter((m) => m.id !== btn.dataset.remove);
  renderMembers();
});

$("#import-pdf").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  els.parseHint.textContent = "正在讀取 PDF…";
  els.parseHint.classList.remove("is-error");
  try {
    const buffer = await file.arrayBuffer();
    const text = await extractPdfText(buffer);
    const parsed = parseRosterText(text);
    if (!parsed.ok) {
      els.parseHint.textContent = parsed.error;
      els.parseHint.classList.add("is-error");
      // 仍顯示原始文字方便除錯
      console.warn("PDF text:\n", text);
      return;
    }
    draftMembers = parsed.members.map((m) => ({ ...m, id: uid() }));
    renderMembers();
    els.parseHint.textContent = `已匯入 ${draftMembers.length} 位交流人員（${file.name}）`;
  } catch (err) {
    console.error(err);
    els.parseHint.textContent = "PDF 讀取失敗，請再試一次";
    els.parseHint.classList.add("is-error");
  }
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const members = collectMembersFromDom().filter(
    (m) => m.name || m.org || m.title || m.gender
  );
  const payload = {
    groupNo: $("#field-groupNo").value.trim(),
    receiptNo: $("#field-receiptNo").value.trim(),
    inviteUnit: $("#field-inviteUnit").value.trim(),
    applicantName: $("#field-applicantName").value.trim(),
    purpose: $("#field-purpose").value.trim(),
    joinedAt: $("#field-joinedAt").value,
    notes: $("#field-notes").value.trim(),
    members,
  };

  if (!payload.groupNo || !payload.inviteUnit || !payload.applicantName) {
    alert("請填寫團號、邀請單位、申請人姓名");
    return;
  }

  if (editingId) {
    records = records.map((r) =>
      r.id === editingId
        ? { ...r, ...payload, updatedAt: new Date().toISOString() }
        : r
    );
  } else {
    // 同團號提醒
    const dup = records.find((r) => r.groupNo === payload.groupNo);
    if (dup && !confirm(`團號 ${payload.groupNo} 已存在，仍要新增？`)) return;
    records.push(createRecord(payload));
  }

  persist();
  els.dialog.close();
});

els.btnDelete.addEventListener("click", () => {
  if (!editingId) return;
  const id = editingId;
  els.dialog.close();
  deleteRecord(id);
});

$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(records, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `moc-cnex-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#import-json").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("格式錯誤");
    if (!confirm(`將匯入 ${data.length} 筆資料（覆蓋目前資料），確定？`)) return;
    records = data;
    persist();
  } catch {
    alert("JSON 匯入失敗，請確認檔案格式");
  }
});

routeReady = true;
startRouter((route) => {
  applyRoute(route);
  render();
});
