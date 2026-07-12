const STORAGE_KEY = "moc-cnex-records-v1";

/**
 * @typedef {{
 *   id: string,
 *   seq: number,
 *   name: string,
 *   gender: string,
 *   org: string,
 *   title: string
 * }} Member
 *
 * @typedef {{
 *   id: string,
 *   groupNo: string,
 *   inviteUnit: string,
 *   receiptNo: string,
 *   applicantName: string,
 *   purpose: string,
 *   joinedAt: string,
 *   members: Member[],
 *   notes: string,
 *   createdAt: string,
 *   updatedAt: string
 * }} Record
 */

/** @returns {Record[]} */
export function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** @param {Record[]} records */
export function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/** @returns {string} */
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {Partial<Record> & { groupNo: string, inviteUnit: string, applicantName: string }} input
 * @returns {Record}
 */
export function createRecord(input) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    groupNo: (input.groupNo || "").trim(),
    inviteUnit: (input.inviteUnit || "").trim(),
    receiptNo: (input.receiptNo || "").trim(),
    applicantName: (input.applicantName || "").trim(),
    purpose: (input.purpose || "").trim(),
    joinedAt: input.joinedAt || "",
    members: Array.isArray(input.members) ? input.members : [],
    notes: (input.notes || "").trim(),
    createdAt: now,
    updatedAt: now,
  };
}
