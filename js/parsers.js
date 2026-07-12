/**
 * 解析移民署自動通知信文字
 * @param {string} text
 */
export function parseImmigrationNotice(text) {
  const src = (text || "").replace(/\s+/g, " ").trim();
  if (!src) return { ok: false, error: "請貼上通知信內容", data: null };

  const pick = (re) => {
    const m = src.match(re);
    return m ? m[1].trim() : "";
  };

  const groupNo = pick(/團號\s*[:：]?\s*(\d+)/);
  const inviteUnit = pick(/邀請單位\s*[『「'']([^』」'']+)[』」'']/);
  const receiptNo = pick(/收件號\s*[:：]?\s*(\d+)/);
  const applicantName =
    pick(/【\s*姓名\s*[:：]\s*([^】]+)】/) || pick(/姓名\s*[:：]\s*([^\s】,，]+)/);
  const purpose = pick(/申請事由\s*[『「'']([^』」'']+)[』」'']/);
  const peopleCount = pick(/共\s*(\d+)\s*人/);
  const joinedRaw = pick(/已於\s*(\d{4}[\/.\-年]\d{1,2}[\/.\-月]\d{1,2}日?)/);

  let joinedAt = "";
  if (joinedRaw) {
    const norm = joinedRaw
      .replace(/年|月/g, "/")
      .replace(/日/g, "")
      .replace(/\./g, "/")
      .replace(/-/g, "/");
    const [y, m, d] = norm.split("/").map((x) => x.padStart(2, "0"));
    if (y && m && d) joinedAt = `${y}-${m}-${d}`;
  }

  if (!groupNo && !receiptNo && !inviteUnit) {
    return {
      ok: false,
      error: "無法辨識團號／邀請單位／收件號，請確認文字格式",
      data: null,
    };
  }

  return {
    ok: true,
    error: "",
    data: {
      groupNo,
      inviteUnit,
      receiptNo,
      applicantName,
      purpose,
      joinedAt,
      peopleCount: peopleCount ? Number(peopleCount) : null,
    },
  };
}

const TITLE_RE =
  /(.+?)\s*((?:總經理|副總經理|經理|董事長|董事|會長|副會長|秘書長|主任|處長|科長|組長|專員|研究員|教授|副教授|講師|顧問|負責人|執行長|執行董事|總監|主編|記者|演員|歌手|製作人|監製)(?:\S*)?)$/;

/**
 * 從團體名冊 PDF 文字解析交流人員
 * 欄位：編號、姓名、性別、現任職單位、職稱
 * @param {string} text
 */
export function parseRosterText(text) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  /** @type {{ seq: number, name: string, gender: string, org: string, title: string }[]} */
  const members = [];

  for (const line of lines) {
    if (
      /編號|姓名|性別|現任職單位|職稱|備註|團體名冊|大陸地區/.test(line) &&
      !/^\d+/.test(line)
    ) {
      continue;
    }

    const parsed = parseRosterLine(line);
    if (parsed) members.push(parsed);
  }

  const bySeq = new Map();
  for (const mem of members) {
    bySeq.set(mem.seq, mem);
  }

  return {
    ok: bySeq.size > 0,
    error: bySeq.size ? "" : "無法從 PDF 解析出人員列，請確認為團體名冊格式",
    members: [...bySeq.values()].sort((a, b) => a.seq - b.seq),
  };
}

/**
 * @param {string} line
 */
function parseRosterLine(line) {
  // 標準：1 李艷斕 女 相信音樂… 經紀事業部副總經理
  // PDF 拆字：1 李 艷 斕 女 相信音樂… 經紀事業部副總經理
  // 反序尾字：1 女 相信音樂… 經紀事業部副總經理 斕 艷 李
  const m = line.match(/^(\d+)\s+(.+)$/);
  if (!m) return null;

  const seq = Number(m[1]);
  const rest = m[2].trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const genderIdx = tokens.findIndex((t) => t === "男" || t === "女");

  if (genderIdx >= 0) {
    const gender = tokens[genderIdx];
    const before = tokens.slice(0, genderIdx);
    const after = tokens.slice(genderIdx + 1);

    // 姓名在性別前（含拆字）
    let name = before.join("");
    let orgTokens = after;
    let title = "";

    // 若性別前無名，姓名可能在列尾單字
    if (!name) {
      const nameChars = [];
      while (orgTokens.length && /^[\u4e00-\u9fff]$/.test(orgTokens[orgTokens.length - 1])) {
        nameChars.push(orgTokens.pop());
      }
      name = nameChars.join("");
    }

    if (orgTokens.length >= 2) {
      // 最後一段當職稱，其餘當單位
      title = orgTokens[orgTokens.length - 1];
      const org = orgTokens.slice(0, -1).join("");
      // 若單位仍含職稱關鍵字且最後一段過短，改用啟發式
      return finalizeMember(seq, name, gender, org, title);
    }

    if (orgTokens.length === 1) {
      return splitOrgTitle(seq, name, gender, orgTokens[0]);
    }

    return finalizeMember(seq, name, gender, "", "");
  }

  // 無性別：嘗試 編號 姓名 單位 職稱
  if (tokens.length >= 3) {
    const name = tokens[0];
    if (/^[\u4e00-\u9fff]{2,8}$/.test(name)) {
      const title = tokens[tokens.length - 1];
      const org = tokens.slice(1, -1).join("");
      return finalizeMember(seq, name, "", org, title);
    }
  }

  return null;
}

function splitOrgTitle(seq, name, gender, blob) {
  const hit = blob.match(TITLE_RE);
  if (hit) {
    return finalizeMember(seq, name, gender, hit[1].trim(), hit[2].trim());
  }
  return finalizeMember(seq, name, gender, blob, "");
}

function finalizeMember(seq, name, gender, org, title) {
  // 單位與職稱黏在一起時再切一次
  if (org && title && title.length <= 2) {
    const merged = org + title;
    const hit = merged.match(TITLE_RE);
    if (hit) {
      org = hit[1].trim();
      title = hit[2].trim();
    }
  } else if (org && !title) {
    const hit = org.match(TITLE_RE);
    if (hit) {
      org = hit[1].trim();
      title = hit[2].trim();
    }
  }

  if (!name && !org && !title) return null;
  return { seq, name, gender, org, title };
}

/**
 * 使用 pdf.js 擷取 PDF 全文（依座標還原列與欄）
 * @param {ArrayBuffer} buffer
 */
export async function extractPdfText(buffer) {
  const pdfjs = await import(
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs"
  );
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const parts = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    /** @type {Map<number, {x:number,str:string}[]>} */
    const rows = new Map();
    for (const item of content.items) {
      if (!("str" in item) || !item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], str: item.str.trim() });
    }
    const sortedYs = [...rows.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const cells = rows.get(y).sort((a, b) => a.x - b.x);
      parts.push(cells.map((c) => c.str).join(" "));
    }
    parts.push("");
  }

  return parts.join("\n");
}
