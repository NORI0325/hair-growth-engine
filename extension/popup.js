const DEFAULTS = {
  filePrefix: makeDefaultPrefix(),
  maxPages: 999,
  pageDelayMs: 300,
  detailDelayMs: 300,
  includeDetails: true,
  includeReservations: true
};

const CUSTOMER_HEADER_PRIORITY = [
  "一覧_氏名（カナ）",
  "一覧_氏名(カナ)",
  "一覧_氏名（漢字）",
  "一覧_氏名(漢字)",
  "一覧_お客様番号",
  "一覧_性別",
  "一覧_職業",
  "一覧_来店回数",
  "一覧_前回来店日",
  "詳細_URL",
  "詳細_顧客ID",
  "詳細_氏名（漢字）",
  "詳細_氏名(漢字)",
  "詳細_氏名（カナ）",
  "詳細_氏名(カナ)",
  "詳細_代表番号1",
  "詳細_代表番号2",
  "詳細_E-MAIL（PC）",
  "詳細_E-MAIL（携帯）",
  "詳細_お客様番号",
  "詳細_住所",
  "詳細_誕生日",
  "詳細_性別",
  "詳細_血液型",
  "詳細_職業",
  "詳細_来店情報_初回来店日",
  "詳細_来店情報_来店きっかけ",
  "詳細_来店情報_来店回数",
  "詳細_メッセージ配信先情報_HOT PEPPER Beautyマイページ",
  "詳細_メッセージ配信先情報_HOT PEPPER Beautyメールアドレス",
  "詳細_メッセージ配信先情報_E-MAIL（PC）",
  "詳細_メッセージ配信先情報_E-MAIL（携帯）",
  "詳細_取得エラー"
];

const RESERVATION_HEADER_PRIORITY = [
  "詳細_顧客ID",
  "一覧_氏名（カナ）",
  "一覧_氏名(カナ)",
  "一覧_氏名（漢字）",
  "一覧_氏名(漢字)",
  "一覧_お客様番号",
  "詳細_URL",
  "予約履歴_来店日",
  "予約履歴_予約日",
  "予約履歴_スタイリスト",
  "予約履歴_予約経路",
  "予約履歴_ステータス",
  "予約履歴_メニュー・販促・割引・サービス・オプション",
  "予約履歴_次回来店向けメモ",
  "予約履歴_カルテ"
];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const saved = await chrome.storage.sync.get(DEFAULTS);
  const config = { ...DEFAULTS, ...saved };

  setValue("filePrefix", config.filePrefix);
  setValue("maxPages", config.maxPages);
  setValue("pageDelayMs", config.pageDelayMs);
  setValue("detailDelayMs", config.detailDelayMs);
  setChecked("includeDetails", config.includeDetails);
  setChecked("includeReservations", config.includeReservations);

  for (const id of ["filePrefix", "maxPages", "pageDelayMs", "detailDelayMs"]) {
    document.getElementById(id).addEventListener("input", saveSettings);
  }
  for (const id of ["includeDetails", "includeReservations"]) {
    document.getElementById(id).addEventListener("change", saveSettings);
  }

  document.getElementById("testBtn").addEventListener("click", () => run("test"));
  document.getElementById("exportBtn").addEventListener("click", () => run("export"));
}

function setValue(id, value) {
  document.getElementById(id).value = value ?? "";
}

function setChecked(id, value) {
  document.getElementById(id).checked = !!value;
}

function getValue(id) {
  return document.getElementById(id).value;
}

function getChecked(id) {
  return document.getElementById(id).checked;
}

function readConfig() {
  return {
    filePrefix: sanitizeFileName(getValue("filePrefix").trim() || makeDefaultPrefix()),
    maxPages: Math.max(1, Number(getValue("maxPages")) || DEFAULTS.maxPages),
    pageDelayMs: Math.max(0, Number(getValue("pageDelayMs")) || DEFAULTS.pageDelayMs),
    detailDelayMs: Math.max(0, Number(getValue("detailDelayMs")) || DEFAULTS.detailDelayMs),
    includeDetails: getChecked("includeDetails"),
    includeReservations: getChecked("includeReservations")
  };
}

async function saveSettings() {
  await chrome.storage.sync.set(readConfig());
}

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function setPreview(message) {
  document.getElementById("preview").textContent = message;
}

async function run(mode) {
  try {
    const config = readConfig();
    await chrome.storage.sync.set(config);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("アクティブなタブを取得できませんでした。");
    }

    if (!/^https:\/\/salonboard\.com\//i.test(tab.url || "")) {
      throw new Error("SalonBoardの画面を開いた状態で実行してください。");
    }

    setStatus(
      mode === "test"
        ? "テスト取得を実行中...\n※ ポップアップを閉じないでください。"
        : "本番取得を実行中...\n※ ポップアップを閉じないでください。"
    );
    setPreview("取得中...");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectedSalonboardExport,
      args: [config, mode]
    });

    if (!result) {
      throw new Error("処理結果を取得できませんでした。");
    }
    if (!result.ok) {
      throw new Error(result.error || "取得に失敗しました。");
    }

    const customers = Array.isArray(result.customers) ? result.customers : [];
    const reservations = Array.isArray(result.reservations) ? result.reservations : [];

    setPreview(buildPreview(customers, reservations));

    const summaryLines = [
      mode === "test" ? "テスト取得完了" : "本番取得完了",
      `一覧件数: ${customers.length}件`,
      `予約履歴件数: ${reservations.length}件`,
      `一覧ページ数: ${result.meta?.pagesFetched ?? "-"}`,
      `詳細取得件数: ${result.meta?.detailsFetched ?? "-"}`,
      `詳細URL未取得件数: ${result.meta?.missingDetailUrlCount ?? "-"}`
    ];

    if (result.warnings?.length) {
      summaryLines.push("", "注意:");
      summaryLines.push(...result.warnings.slice(0, 8));
      if (result.warnings.length > 8) {
        summaryLines.push(`...他 ${result.warnings.length - 8} 件`);
      }
    }

    if (mode === "test") {
      setStatus(summaryLines.join("\n"), false);
      return;
    }

    const prefix = sanitizeFileName(config.filePrefix || makeDefaultPrefix());

    if (customers.length > 0) {
      const customerHeaders = sortHeaders(collectHeaders(customers), CUSTOMER_HEADER_PRIORITY);
      await downloadCsv(`${prefix}_customers.csv`, customers, customerHeaders);
    }

    if (config.includeReservations && reservations.length > 0) {
      const reservationHeaders = sortHeaders(collectHeaders(reservations), RESERVATION_HEADER_PRIORITY);
      await downloadCsv(`${prefix}_reservations.csv`, reservations, reservationHeaders);
    }

    summaryLines.push("", "CSV保存を開始しました。");
    setStatus(summaryLines.join("\n"), false);
  } catch (error) {
    console.error(error);
    setStatus(`エラー: ${error.message}`, true);
    setPreview("失敗しました。必要ならこの画面のスクショを送ってください。");
  }
}

function buildPreview(customers, reservations) {
  const lines = [];

  if (customers.length) {
    lines.push("[customers preview]");

    const preferredKeys = [
      "一覧_氏名（カナ）",
      "一覧_氏名（漢字）",
      "一覧_お客様番号",
      "一覧_性別",
      "一覧_職業",
      "一覧_来店回数",
      "一覧_前回来店日",
      "詳細_顧客ID",
      "詳細_氏名（漢字）",
      "詳細_氏名（カナ）",
      "詳細_代表番号1",
      "詳細_誕生日",
      "詳細_来店情報_初回来店日",
      "詳細_取得エラー"
    ];

    customers.slice(0, 5).forEach((row, idx) => {
      const cols = [];
      for (const key of preferredKeys) {
        if (row[key]) cols.push(`${key}=${row[key]}`);
      }
      if (cols.length < 3) {
        for (const [k, v] of Object.entries(row).slice(0, 12)) {
          if (v) cols.push(`${k}=${v}`);
        }
      }
      lines.push(`${idx + 1}. ${cols.join(" | ")}`);
    });
  } else {
    lines.push("customers: 0件");
  }

  lines.push("");

  if (reservations.length) {
    lines.push("[reservations preview]");
    reservations.slice(0, 5).forEach((row, idx) => {
      const pairs = Object.entries(row).slice(0, 12).map(([k, v]) => `${k}=${v}`);
      lines.push(`${idx + 1}. ${pairs.join(" | ")}`);
    });
  } else {
    lines.push("reservations: 0件");
  }

  return lines.join("\n");
}

function collectHeaders(rows) {
  const set = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      set.add(key);
    }
  }
  return Array.from(set);
}

function sortHeaders(headers, priority) {
  const priorityMap = new Map(priority.map((h, i) => [h, i]));
  return [...headers].sort((a, b) => {
    const pa = priorityMap.has(a) ? priorityMap.get(a) : Number.MAX_SAFE_INTEGER;
    const pb = priorityMap.has(b) ? priorityMap.get(b) : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b, "ja");
  });
}

async function downloadCsv(filename, rows, headers) {
  const csv = buildCsv(rows, headers);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function buildCsv(rows, headers) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));

  for (const row of rows) {
    const cols = headers.map(h => csvEscape(row[h] ?? ""));
    lines.push(cols.join(","));
  }

  return "\uFEFF" + lines.join("\r\n");
}

function csvEscape(value) {
  const s = String(value ?? "").replace(/\r?\n/g, " ");
  if (/[",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || makeDefaultPrefix();
}

function makeDefaultPrefix() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `salonboard_export_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * この関数は SalonBoard ページ上で実行される
 */
async function injectedSalonboardExport(config, mode) {
  try {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const parser = new DOMParser();
    const warnings = [];

    function normalizeText(value) {
      return String(value ?? "")
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
    }

    function cleanHeaderText(text) {
      return normalizeText(text)
        .replace(/\s*i$/i, "")
        .replace(/[▲▼△▽]/g, "")
        .replace(/[：:]+$/g, "")
        .trim();
    }

    function safeAbsUrl(url, base) {
      try {
        return new URL(url, base).href;
      } catch (_) {
        return "";
      }
    }

    function parseHtml(html) {
      return parser.parseFromString(html, "text/html");
    }

    async function fetchHtml(url, init = {}) {
      const res = await fetch(url, {
        credentials: "include",
        redirect: "follow",
        ...init
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
      }

      const text = await res.text();
      return {
        url: res.url || url,
        html: text,
        doc: parseHtml(text)
      };
    }

    function detectTotalPages(doc) {
      const text = normalizeText(doc.body?.innerText || doc.body?.textContent || "");
      const m = text.match(/(\d+)\s*\/\s*(\d+)\s*ページ/);
      return m ? Number(m[2]) : 1;
    }

    function detectCurrentPage(doc, currentUrl) {
      try {
        const u = new URL(currentUrl);
        const pn = Number(u.searchParams.get("pn"));
        if (Number.isFinite(pn) && pn >= 1) return pn;
      } catch (_) {}

      const text = normalizeText(doc.body?.innerText || doc.body?.textContent || "");
      const m = text.match(/(\d+)\s*\/\s*(\d+)\s*ページ/);
      return m ? Number(m[1]) : 1;
    }

    function buildListPageUrl(baseUrl, pn) {
      const u = new URL(baseUrl);
      u.searchParams.set("pn", String(pn));
      return u.href;
    }

    function directChildrenByTags(el, tags) {
      const tagSet = new Set(tags.map(v => String(v).toUpperCase()));
      return Array.from(el.children || []).filter(ch => tagSet.has(ch.tagName));
    }

    function extractDirectCellTexts(tr) {
      return directChildrenByTags(tr, ["th", "td"]).map(cell =>
        normalizeText(cell.innerText || cell.textContent || "")
      );
    }

    function findBestListTable(doc) {
      const expectedWords = ["氏名", "お客様番号", "来店回数", "前回来店日", "性別", "職業"];
      const tables = Array.from(doc.querySelectorAll("table"));
      let best = null;
      let bestScore = -1;

      for (const table of tables) {
        const allText = normalizeText(table.innerText || table.textContent || "");
        const rows = Array.from(table.querySelectorAll("tr"));
        const tdRows = rows.filter(tr => directChildrenByTags(tr, ["td"]).length >= 3);

        let score = 0;
        score += Math.min(tdRows.length, 100);

        for (const word of expectedWords) {
          if (allText.includes(word)) score += 50;
        }

        if (/来店回数/.test(allText)) score += 50;
        if (/前回来店日/.test(allText)) score += 50;
        if (/お客様番号/.test(allText)) score += 50;

        if (score > bestScore) {
          best = table;
          bestScore = score;
        }
      }

      return best;
    }

    function parseCustomerIdFromText(text) {
      const raw = String(text || "");

      const patterns = [
        /customerId['"\s:=,]*['"]?(C[0-9A-Za-z-]{6,})['"]?/i,
        /customerId=(C[0-9A-Za-z-]{6,})/i,
        /\b(C\d{8,})\b/i
      ];

      for (const re of patterns) {
        const m = raw.match(re);
        if (m?.[1]) return m[1];
      }

      return "";
    }

    function buildDetailRequest(customerId, pageUrl) {
      if (!customerId) return null;

      const params = new URLSearchParams();
      params.set("customerId", customerId);
      params.set("qs", `customerId=${customerId}`);

      return {
        method: "POST",
        url: safeAbsUrl("/CLP/bt/customer/customerDetail/", pageUrl),
        customerId,
        body: params.toString()
      };
    }

    function extractDetailRequestFromRow(tr, pageUrl) {
      const blob = [
        tr.outerHTML || "",
        ...Array.from(tr.querySelectorAll("a, button, [onclick]")).map(el => [
          el.getAttribute("href") || "",
          el.getAttribute("onclick") || "",
          el.getAttribute("data-href") || "",
          el.outerHTML || ""
        ].join(" "))
      ].join(" ");

      const customerId = parseCustomerIdFromText(blob);
      if (!customerId) return null;

      return buildDetailRequest(customerId, pageUrl);
    }

    function extractListPage(doc, pageUrl) {
      const table = findBestListTable(doc);
      if (!table) {
        return { entries: [], headers: [] };
      }

      function getCellText(td) {
        if (!td) return "";

        const aText = normalizeText(
          td.querySelector("a")?.innerText ||
          td.querySelector("a")?.textContent ||
          ""
        );
        if (aText) return aText;

        return normalizeText(td.innerText || td.textContent || "");
      }

      function pickSevenColumns(tds) {
        if (tds.length === 7) return tds;
        if (tds.length > 7) return tds.slice(tds.length - 7);
        return null;
      }

      const rows = Array.from(table.querySelectorAll("tr"))
        .filter(tr => directChildrenByTags(tr, ["td"]).length >= 7);

      const entries = [];

      for (const tr of rows) {
        const rawTds = directChildrenByTags(tr, ["td"]);
        const tds = pickSevenColumns(rawTds);
        if (!tds || tds.length < 7) continue;

        const rowData = {
          "一覧_氏名（カナ）": getCellText(tds[0]),
          "一覧_氏名（漢字）": getCellText(tds[1]),
          "一覧_お客様番号": getCellText(tds[2]),
          "一覧_性別": getCellText(tds[3]),
          "一覧_職業": getCellText(tds[4]),
          "一覧_来店回数": getCellText(tds[5]),
          "一覧_前回来店日": getCellText(tds[6])
        };

        const hasAnyValue = Object.values(rowData).some(v => normalizeText(v));
        if (!hasAnyValue) continue;

        const detailRequest = extractDetailRequestFromRow(tr, pageUrl);
        if (detailRequest?.url) {
          rowData["詳細_URL"] = detailRequest.url;
        }
        if (detailRequest?.customerId) {
          rowData["詳細_顧客ID"] = detailRequest.customerId;
        }

        entries.push({
          data: rowData,
          detailRequest
        });
      }

      return {
        entries,
        headers: [
          "氏名（カナ）",
          "氏名（漢字）",
          "お客様番号",
          "性別",
          "職業",
          "来店回数",
          "前回来店日"
        ]
      };
    }

    function findNearestSectionTitle(table) {
      const knownPattern = /(基本情報|来店情報|メッセージ配信先情報|メッセージ配信履歴|予約履歴)/;

      let node = table;
      for (let depth = 0; depth < 8 && node; depth++) {
        let prev = node.previousElementSibling;
        while (prev) {
          const text = normalizeText(prev.textContent || "");
          const m = text.match(knownPattern);
          if (m?.[1]) return m[1];
          prev = prev.previousElementSibling;
        }
        node = node.parentElement;
      }

      return "";
    }

    function parseKeyValueTable(table, sectionTitle) {
      const out = {};
      const rows = Array.from(table.querySelectorAll("tr"));

      for (const tr of rows) {
        const cells = directChildrenByTags(tr, ["th", "td"]);
        if (cells.length < 2) continue;

        for (let i = 0; i < cells.length - 1; i++) {
          const left = cells[i];
          const right = cells[i + 1];

          if (left.tagName !== "TH" || right.tagName !== "TD") continue;

          const label = cleanHeaderText(left.innerText || left.textContent || "");
          const value = normalizeText(right.innerText || right.textContent || "");
          if (!label) continue;

          const key =
            !sectionTitle || sectionTitle === "基本情報"
              ? `詳細_${label}`
              : `詳細_${sectionTitle}_${label}`;

          if (!Object.prototype.hasOwnProperty.call(out, key) || !out[key]) {
            out[key] = value;
          }

          i += 1;
        }
      }

      return out;
    }

    function getTableRows(table) {
      return Array.from(table.querySelectorAll("tr"))
        .filter(tr => directChildrenByTags(tr, ["th", "td"]).length > 0);
    }

    function getGridHeaders(table) {
      const rows = getTableRows(table);
      if (!rows.length) return [];
      return directChildrenByTags(rows[0], ["th", "td"])
        .map(cell => cleanHeaderText(cell.innerText || cell.textContent || ""))
        .filter(Boolean);
    }

    function isGridTable(table) {
      const rows = getTableRows(table);
      if (rows.length < 2) return false;

      const first = extractDirectCellTexts(rows[0]).filter(Boolean);
      const second = extractDirectCellTexts(rows[1]).filter(Boolean);

      return first.length >= 3 && second.length >= 2;
    }

    function looksLikeReservationTable(table, sectionTitle) {
      const headers = getGridHeaders(table);
      const joined = headers.join("|");
      const tableText = normalizeText(table.innerText || table.textContent || "");

      if (sectionTitle === "予約履歴") return true;

      const hasDate = /来店日|予約日/.test(joined) || /来店日|予約日/.test(tableText);
      const hasStaff = /スタイリスト|担当/.test(joined) || /スタイリスト|担当/.test(tableText);
      const hasStatus = /ステータス/.test(joined) || /ステータス/.test(tableText);
      const hasRoute = /予約経路/.test(joined) || /予約経路/.test(tableText);
      const hasMenu = /メニュー|販促|割引|サービス|オプション/.test(joined) || /メニュー|販促|割引|サービス|オプション/.test(tableText);
      const hasKarte = /カルテ/.test(joined) || /カルテ/.test(tableText);

      return hasDate && (hasStaff || hasStatus || hasRoute || hasMenu || hasKarte);
    }

    function alignCellsToHeaders(headers, cells) {
      const hLen = headers.length;
      const cLen = cells.length;

      if (hLen === 0) return cells.slice();
      if (cLen === hLen) return cells.slice();
      if (cLen > hLen) return cells.slice(0, hLen);

      return [...cells, ...Array.from({ length: hLen - cLen }, () => "")];
    }

    function parseGridTable(table, prefix) {
      const rows = getTableRows(table);
      if (rows.length < 2) return [];

      const headers = extractDirectCellTexts(rows[0]).map(cleanHeaderText).filter(Boolean);
      if (headers.length < 2) return [];

      const out = [];
      for (const tr of rows.slice(1)) {
        const values = extractDirectCellTexts(tr);
        if (!values.some(Boolean)) continue;

        const aligned = alignCellsToHeaders(headers, values);
        const row = {};
        headers.forEach((h, idx) => {
          row[`${prefix}${h}`] = aligned[idx] ?? "";
        });
        out.push(row);
      }
      return out;
    }

    function mergeValue(target, key, value) {
      const v = normalizeText(value);
      if (!key || !v) return;

      if (!Object.prototype.hasOwnProperty.call(target, key) || !target[key]) {
        target[key] = v;
        return;
      }

      if (target[key] === v) return;

      let idx = 2;
      while (Object.prototype.hasOwnProperty.call(target, `${key}_${idx}`)) {
        idx += 1;
      }
      target[`${key}_${idx}`] = v;
    }

    function parseDetailPage(doc, detailUrl, baseCustomer) {
      const detailFields = {};
      const reservations = [];

      const pageText = normalizeText(doc.body?.innerText || doc.body?.textContent || "");
      detailFields["詳細_URL"] = detailUrl || "";
      detailFields["詳細_顧客ID"] = baseCustomer["詳細_顧客ID"] || "";

      if (/顧客ID[:：]?\s*(C[0-9A-Za-z-]+)/i.test(pageText)) {
        detailFields["詳細_顧客ID"] = pageText.match(/顧客ID[:：]?\s*(C[0-9A-Za-z-]+)/i)?.[1] || detailFields["詳細_顧客ID"];
      }

      const tables = Array.from(doc.querySelectorAll("table"));

      for (const table of tables) {
        const sectionTitle = findNearestSectionTitle(table);
        const tableText = normalizeText(table.innerText || table.textContent || "");
        if (!tableText) continue;

        if (looksLikeReservationTable(table, sectionTitle) && isGridTable(table)) {
          const rows = parseGridTable(table, "予約履歴_");
          for (const r of rows) {
            const record = {
              "詳細_URL": detailUrl || "",
              "詳細_顧客ID": detailFields["詳細_顧客ID"] || baseCustomer["詳細_顧客ID"] || "",
              "一覧_氏名（カナ）": baseCustomer["一覧_氏名（カナ）"] || "",
              "一覧_氏名（漢字）": baseCustomer["一覧_氏名（漢字）"] || "",
              "一覧_お客様番号": baseCustomer["一覧_お客様番号"] || ""
            };

            for (const [k, v] of Object.entries(r)) {
              record[k] = v;
            }

            reservations.push(record);
          }
          continue;
        }

        const kv = parseKeyValueTable(table, sectionTitle);
        for (const [k, v] of Object.entries(kv)) {
          mergeValue(detailFields, k, v);
        }
      }

      if (!/お客様情報詳細|基本情報|来店情報/.test(pageText)) {
        detailFields["詳細_取得エラー"] = "詳細ページ本文を取得できませんでした";
      } else if (Object.keys(detailFields).length <= 2) {
        detailFields["詳細_取得エラー"] = "詳細本文は開けたが、項目抽出に失敗";
      }

      return { detailFields, reservations };
    }

    function buildCustomerKey(entry) {
      const row = entry.data || {};
      const detailRequest = entry.detailRequest || {};

      const customerId = row["詳細_顧客ID"] || detailRequest.customerId || "";
      const customerNumber = row["一覧_お客様番号"] || "";
      const kana = row["一覧_氏名（カナ）"] || "";
      const kanji = row["一覧_氏名（漢字）"] || "";
      const lastVisit = row["一覧_前回来店日"] || "";
      const visitCount = row["一覧_来店回数"] || "";

      if (customerId) return `CID:${customerId}`;
      if (customerNumber && customerNumber !== "-") return `NO:${customerNumber}`;
      if (kana || kanji || lastVisit || visitCount) return `NAME:${kana}|${kanji}|${lastVisit}|${visitCount}`;

      const detailUrl = row["詳細_URL"] || detailRequest.url || "";
      if (detailUrl) return `URL:${detailUrl}`;

      return "";
    }

    async function fetchDetailDocument(detailRequest, refererUrl) {
      if (!detailRequest?.url) {
        throw new Error("詳細URLがありません。");
      }

      const body = detailRequest.body || "";
      return fetchHtml(detailRequest.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body,
        referrer: refererUrl || location.href
      });
    }

    const currentUrl = location.href;
    const currentPage = detectCurrentPage(document, currentUrl);
    const detectedTotalPages = detectTotalPages(document);
    const totalPages = Math.max(1, Math.min(Number(config.maxPages) || 1, detectedTotalPages || 1));

    const pageNumbers =
      mode === "test"
        ? [currentPage]
        : Array.from({ length: totalPages }, (_, i) => i + 1);

    const allEntries = [];
    let pagesFetched = 0;

    for (const pn of pageNumbers) {
      let pageDoc;
      let pageUrl;

      if (pn === currentPage) {
        pageDoc = document;
        pageUrl = currentUrl;
      } else {
        pageUrl = buildListPageUrl(currentUrl, pn);
        const fetched = await fetchHtml(pageUrl, { method: "GET", referrer: currentUrl });
        pageDoc = fetched.doc;
        pageUrl = fetched.url;

        if (config.pageDelayMs > 0) {
          await sleep(config.pageDelayMs);
        }
      }

      const extracted = extractListPage(pageDoc, pageUrl);
      if (!extracted.entries.length) {
        warnings.push(`ページ ${pn}: 一覧行を取得できませんでした。`);
      }

      allEntries.push(...extracted.entries);
      pagesFetched += 1;
    }

    const dedupedEntries = [];
    const seenCustomerKeys = new Set();

    for (const entry of allEntries) {
      const key = buildCustomerKey(entry);
      if (!key) continue;
      if (seenCustomerKeys.has(key)) continue;
      seenCustomerKeys.add(key);
      dedupedEntries.push(entry);
    }

    const missingDetailUrlCount = dedupedEntries.filter(entry => !entry.detailRequest?.url).length;

    let detailsFetched = 0;
    const reservationRows = [];
    const seenReservationKeys = new Set();

    if (config.includeDetails) {
      const targets = mode === "test" ? dedupedEntries.slice(0, 3) : dedupedEntries;

      for (const entry of targets) {
        if (!entry.detailRequest?.url) {
          entry.data["詳細_取得エラー"] = "詳細URLを取得できませんでした";
          continue;
        }

        try {
          const fetched = await fetchDetailDocument(entry.detailRequest, currentUrl);
          const parsed = parseDetailPage(fetched.doc, fetched.url || entry.detailRequest.url, entry.data);

          for (const [k, v] of Object.entries(parsed.detailFields)) {
            mergeValue(entry.data, k, v);
          }

          if (config.includeReservations) {
            for (const row of parsed.reservations) {
              const reservationKey = JSON.stringify(row);
              if (seenReservationKeys.has(reservationKey)) continue;
              seenReservationKeys.add(reservationKey);
              reservationRows.push(row);
            }
          }

          detailsFetched += 1;
        } catch (err) {
          const message = normalizeText(err?.message || "詳細取得エラー");
          entry.data["詳細_取得エラー"] = message;
          warnings.push(
            `詳細取得失敗: ${
              entry.data["一覧_氏名（漢字）"] ||
              entry.data["一覧_氏名（カナ）"] ||
              "(氏名不明)"
            } / ${message}`
          );
        }

        if (config.detailDelayMs > 0) {
          await sleep(config.detailDelayMs);
        }
      }
    }

    const customers = dedupedEntries.map(entry => entry.data);

    return {
      ok: true,
      customers,
      reservations: config.includeReservations ? reservationRows : [],
      meta: {
        pagesFetched,
        detailsFetched,
        missingDetailUrlCount,
        detectedTotalPages,
        currentPage
      },
      warnings
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}
