// =====================================================
// Salon Boost — SalonBoard Importer v2.0.2
// セキュア設計：
//   - Salon Boost にログイン必須
//   - アクティブサブスクリプション必須
//   - CSVローカル保存なし（直接サーバー送信のみ）
// =====================================================

const SUPABASE_URL = "https://miyedioemkzhetphjzzg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1peWVkaW9lbWt6aGV0cGhqenpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMDQ1NjgsImV4cCI6MjA5Mjg4MDU2OH0.Eol9UKE46E0TXJdw84ro3csac4ah3RVUsOhVGcT4HRc";

// ============= 認証 =============
async function getStoredAuth() {
  const { sb_auth } = await chrome.storage.local.get("sb_auth");
  return sb_auth || null;
}

async function setStoredAuth(auth) {
  await chrome.storage.local.set({ sb_auth: auth });
}

async function clearStoredAuth() {
  await chrome.storage.local.remove(["sb_auth", "sb_locations", "sb_user_email"]);
}

async function isTokenValid(auth) {
  if (!auth?.access_token || !auth?.expires_at) return false;
  // 期限の60秒前までは有効とみなす
  return auth.expires_at * 1000 > Date.now() + 60_000;
}

async function refreshSession(auth) {
  if (!auth?.refresh_token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function getValidToken() {
  let auth = await getStoredAuth();
  if (!auth) return null;
  if (await isTokenValid(auth)) return auth.access_token;
  const refreshed = await refreshSession(auth);
  if (!refreshed?.access_token) {
    await clearStoredAuth();
    return null;
  }
  await setStoredAuth(refreshed);
  return refreshed.access_token;
}

async function loginWithPassword(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "ログインに失敗しました");
  return data;
}

// ============= API呼び出し =============
async function fetchLocations(token) {
  // 自分が所属している店舗のみを返すRPC（公開予約スラッグの他サロン店舗を除外）
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_my_member_locations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: "{}",
    }
  );
  if (!res.ok) throw new Error(`店舗取得失敗 (${res.status})`);
  return await res.json();
}

async function ingestCustomers(token, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-salonboard-customers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `送信失敗 (${res.status})`);
  return data;
}

// ============= UI =============
const $ = (id) => document.getElementById(id);
const setText = (id, text) => { $(id).textContent = text; };
const setStatus = (id, msg, kind = "") => {
  const el = $(id);
  el.textContent = msg;
  el.className = kind;
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("loginBtn").addEventListener("click", handleLogin);
  $("logoutBtn").addEventListener("click", handleLogout);
  $("testBtn").addEventListener("click", () => runScrape("test"));
  $("sendBtn").addEventListener("click", () => runScrape("send"));

  await refreshUI();
}

async function refreshUI() {
  const token = await getValidToken();
  if (!token) {
    $("login-section").classList.remove("hidden");
    $("main-section").classList.add("hidden");
    return;
  }
  $("login-section").classList.add("hidden");
  $("main-section").classList.remove("hidden");

  // ユーザー情報表示
  const { sb_user_email } = await chrome.storage.local.get("sb_user_email");
  setText("user-email", sb_user_email || "");

  // 店舗一覧取得
  try {
    const locations = await fetchLocations(token);
    const sel = $("locationSelect");
    sel.innerHTML = "";
    if (!locations.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(店舗が見つかりません)";
      sel.appendChild(opt);
    } else {
      for (const loc of locations) {
        const opt = document.createElement("option");
        opt.value = loc.id;
        opt.textContent = loc.name + (loc.is_primary ? " ★" : "");
        sel.appendChild(opt);
      }
    }
    await chrome.storage.local.set({ sb_locations: locations });
  } catch (e) {
    setStatus("status", "店舗一覧の取得に失敗: " + e.message, "error");
  }
}

async function handleLogin() {
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) {
    setStatus("login-status", "メールとパスワードを入力してください", "error");
    return;
  }
  setStatus("login-status", "認証中…");
  try {
    const auth = await loginWithPassword(email, password);
    await setStoredAuth(auth);
    await chrome.storage.local.set({ sb_user_email: email });
    setStatus("login-status", "ログイン成功", "success");
    await refreshUI();
  } catch (e) {
    setStatus("login-status", e.message || "ログインエラー", "error");
  }
}

async function handleLogout() {
  await clearStoredAuth();
  await refreshUI();
  setStatus("login-status", "ログアウトしました", "");
}

// ============= 取込本体 =============
async function runScrape(mode) {
  const token = await getValidToken();
  if (!token) {
    setStatus("status", "ログインが必要です", "error");
    await refreshUI();
    return;
  }
  const locationId = $("locationSelect").value || null;
  if (!locationId && mode === "send") {
    setStatus("status", "送信先の店舗を選択してください", "error");
    return;
  }

  const config = {
    maxPages: Math.max(1, Number($("maxPages").value) || 999),
    pageDelayMs: Math.max(0, Number($("pageDelayMs").value) || 500),
    detailDelayMs: Math.max(0, Number($("detailDelayMs").value) || 500),
    includeDetails: $("includeDetails").checked,
    includeReservations: false, // v2.0では予約履歴は別途実装
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("status", "アクティブなタブが取得できません", "error");
    return;
  }
  if (!/^https:\/\/salonboard\.com\//i.test(tab.url || "")) {
    setStatus("status", "SalonBoardの「お客様一覧」ページで実行してください", "error");
    return;
  }

  setStatus(
    "status",
    mode === "test"
      ? "テスト取得中…（現在ページのみ＋先頭3件詳細）"
      : "本番取込中…（全ページ自動巡回・閉じないでください）",
    ""
  );

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectedSalonboardExport,
      args: [config, mode === "send" ? "export" : "test"],
    });

    if (!result) throw new Error("スクレイピング結果が取得できませんでした");
    if (!result.ok) throw new Error(result.error || "取得失敗");

    const customers = result.customers || [];
    const reservations = result.reservations || [];

    if (mode === "test") {
      setStatus(
        "status",
        `テスト完了 ✓\n取得: ${customers.length}件 / 詳細: ${result.meta?.detailsFetched ?? 0}件\n\nそのまま本番送信すると、Salon Boostの顧客リストに保存されます（CSVは作成されません）。`,
        "success"
      );
      return;
    }

    // 本番送信（500件ずつのチャンクに分割してタイムアウト回避）
    const CHUNK = 500;
    const totals = { total: 0, inserted: 0, updated: 0, skipped: 0 };
    const chunkCount = Math.ceil(customers.length / CHUNK);

    for (let i = 0; i < customers.length; i += CHUNK) {
      const slice = customers.slice(i, i + CHUNK);
      const chunkIdx = Math.floor(i / CHUNK) + 1;
      setStatus(
        "status",
        `Salon Boostへ送信中… (${chunkIdx}/${chunkCount}) ${slice.length}件処理`
      );
      // 予約は1回目のチャンクにのみ含める
      const payload = {
        location_id: locationId,
        customers: slice,
        reservations: i === 0 ? reservations : [],
      };
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await ingestCustomers(token, payload);
          totals.total += r.total || slice.length;
          totals.inserted += r.inserted || 0;
          totals.updated += r.updated || 0;
          totals.skipped += r.skipped || 0;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          // 504/timeout は少し待って再試行
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      if (lastErr) throw new Error(`チャンク${chunkIdx}/${chunkCount}で失敗: ${lastErr.message}`);
    }

    setStatus(
      "status",
      `✅ 送信完了\n` +
        `総数: ${totals.total}件\n` +
        `新規追加: ${totals.inserted}件\n` +
        `更新: ${totals.updated}件\n` +
        `スキップ: ${totals.skipped}件\n\n` +
        `Salon Boost の「顧客」ページで確認できます。`,
      "success"
    );
  } catch (e) {
    setStatus("status", "エラー: " + (e?.message || String(e)), "error");
  }
}

// ============================================================
// SalonBoardページ内で実行されるスクレイピング関数（既存ロジックを維持）
// ============================================================
async function injectedSalonboardExport(config, mode) {
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const parser = new DOMParser();
    const warnings = [];

    function normalizeText(value) {
      return String(value ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    }
    function cleanHeaderText(text) {
      return normalizeText(text).replace(/\s*i$/i, "").replace(/[▲▼△▽]/g, "").replace(/[：:]+$/g, "").trim();
    }
    function safeAbsUrl(url, base) { try { return new URL(url, base).href; } catch { return ""; } }
    function parseHtml(html) { return parser.parseFromString(html, "text/html"); }

    async function fetchHtml(url, init = {}) {
      const res = await fetch(url, { credentials: "include", redirect: "follow", ...init });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
      const text = await res.text();
      return { url: res.url || url, html: text, doc: parseHtml(text) };
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
      } catch {}
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
      const tagSet = new Set(tags.map((v) => String(v).toUpperCase()));
      return Array.from(el.children || []).filter((ch) => tagSet.has(ch.tagName));
    }
    function extractDirectCellTexts(tr) {
      return directChildrenByTags(tr, ["th", "td"]).map((cell) =>
        normalizeText(cell.innerText || cell.textContent || "")
      );
    }
    function findBestListTable(doc) {
      const expectedWords = ["氏名", "お客様番号", "来店回数", "前回来店日", "性別", "職業"];
      const tables = Array.from(doc.querySelectorAll("table"));
      let best = null, bestScore = -1;
      for (const table of tables) {
        const allText = normalizeText(table.innerText || table.textContent || "");
        const rows = Array.from(table.querySelectorAll("tr"));
        const tdRows = rows.filter((tr) => directChildrenByTags(tr, ["td"]).length >= 3);
        let score = Math.min(tdRows.length, 100);
        for (const word of expectedWords) if (allText.includes(word)) score += 50;
        if (/来店回数/.test(allText)) score += 50;
        if (/前回来店日/.test(allText)) score += 50;
        if (/お客様番号/.test(allText)) score += 50;
        if (score > bestScore) { best = table; bestScore = score; }
      }
      return best;
    }
    function parseCustomerIdFromText(text) {
      const raw = String(text || "");
      const patterns = [
        /customerId['"\s:=,]*['"]?(C[0-9A-Za-z-]{6,})['"]?/i,
        /customerId=(C[0-9A-Za-z-]{6,})/i,
        /\b(C\d{8,})\b/i,
      ];
      for (const re of patterns) { const m = raw.match(re); if (m?.[1]) return m[1]; }
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
        body: params.toString(),
      };
    }
    function extractDetailRequestFromRow(tr, pageUrl) {
      const blob = [
        tr.outerHTML || "",
        ...Array.from(tr.querySelectorAll("a, button, [onclick]")).map((el) =>
          [el.getAttribute("href") || "", el.getAttribute("onclick") || "", el.getAttribute("data-href") || "", el.outerHTML || ""].join(" ")
        ),
      ].join(" ");
      const customerId = parseCustomerIdFromText(blob);
      if (!customerId) return null;
      return buildDetailRequest(customerId, pageUrl);
    }
    function extractListPage(doc, pageUrl) {
      const table = findBestListTable(doc);
      if (!table) return { entries: [] };
      function getCellText(td) {
        if (!td) return "";
        const aText = normalizeText(td.querySelector("a")?.innerText || td.querySelector("a")?.textContent || "");
        if (aText) return aText;
        return normalizeText(td.innerText || td.textContent || "");
      }
      function pickSevenColumns(tds) {
        if (tds.length === 7) return tds;
        if (tds.length > 7) return tds.slice(tds.length - 7);
        return null;
      }
      const rows = Array.from(table.querySelectorAll("tr")).filter((tr) => directChildrenByTags(tr, ["td"]).length >= 7);
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
          "一覧_前回来店日": getCellText(tds[6]),
        };
        const hasAnyValue = Object.values(rowData).some((v) => normalizeText(v));
        if (!hasAnyValue) continue;
        const detailRequest = extractDetailRequestFromRow(tr, pageUrl);
        if (detailRequest?.url) rowData["詳細_URL"] = detailRequest.url;
        if (detailRequest?.customerId) rowData["詳細_顧客ID"] = detailRequest.customerId;
        entries.push({ data: rowData, detailRequest });
      }
      return { entries };
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
          const left = cells[i], right = cells[i + 1];
          if (left.tagName !== "TH" || right.tagName !== "TD") continue;
          const label = cleanHeaderText(left.innerText || left.textContent || "");
          const value = normalizeText(right.innerText || right.textContent || "");
          if (!label) continue;
          const key = !sectionTitle || sectionTitle === "基本情報" ? `詳細_${label}` : `詳細_${sectionTitle}_${label}`;
          if (!Object.prototype.hasOwnProperty.call(out, key) || !out[key]) out[key] = value;
          i += 1;
        }
      }
      return out;
    }
    function mergeValue(target, key, value) {
      const v = normalizeText(value);
      if (!key || !v) return;
      if (!Object.prototype.hasOwnProperty.call(target, key) || !target[key]) { target[key] = v; return; }
      if (target[key] === v) return;
      let idx = 2;
      while (Object.prototype.hasOwnProperty.call(target, `${key}_${idx}`)) idx += 1;
      target[`${key}_${idx}`] = v;
    }
    function parseDetailPage(doc, detailUrl, baseCustomer) {
      const detailFields = {};
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
        const kv = parseKeyValueTable(table, sectionTitle);
        for (const [k, v] of Object.entries(kv)) mergeValue(detailFields, k, v);
      }
      if (!/お客様情報詳細|基本情報|来店情報/.test(pageText)) {
        detailFields["詳細_取得エラー"] = "詳細ページ本文を取得できませんでした";
      } else if (Object.keys(detailFields).length <= 2) {
        detailFields["詳細_取得エラー"] = "詳細本文は開けたが、項目抽出に失敗";
      }
      return { detailFields };
    }
    function buildCustomerKey(entry) {
      const row = entry.data || {};
      const detailRequest = entry.detailRequest || {};
      const customerId = row["詳細_顧客ID"] || detailRequest.customerId || "";
      const customerNumber = row["一覧_お客様番号"] || "";
      const kana = row["一覧_氏名（カナ）"] || "", kanji = row["一覧_氏名（漢字）"] || "";
      const lastVisit = row["一覧_前回来店日"] || "", visitCount = row["一覧_来店回数"] || "";
      if (customerId) return `CID:${customerId}`;
      if (customerNumber && customerNumber !== "-") return `NO:${customerNumber}`;
      if (kana || kanji || lastVisit || visitCount) return `NAME:${kana}|${kanji}|${lastVisit}|${visitCount}`;
      return row["詳細_URL"] || detailRequest.url || "";
    }
    async function fetchDetailDocument(detailRequest, refererUrl) {
      if (!detailRequest?.url) throw new Error("詳細URLがありません。");
      return fetchHtml(detailRequest.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: detailRequest.body || "",
        referrer: refererUrl || location.href,
      });
    }

    const currentUrl = location.href;
    const currentPage = detectCurrentPage(document, currentUrl);
    const detectedTotalPages = detectTotalPages(document);
    const totalPages = Math.max(1, Math.min(Number(config.maxPages) || 1, detectedTotalPages || 1));
    const pageNumbers = mode === "test" ? [currentPage] : Array.from({ length: totalPages }, (_, i) => i + 1);

    const allEntries = [];
    let pagesFetched = 0;

    for (const pn of pageNumbers) {
      let pageDoc, pageUrl;
      if (pn === currentPage) { pageDoc = document; pageUrl = currentUrl; }
      else {
        pageUrl = buildListPageUrl(currentUrl, pn);
        const fetched = await fetchHtml(pageUrl, { method: "GET", referrer: currentUrl });
        pageDoc = fetched.doc; pageUrl = fetched.url;
        if (config.pageDelayMs > 0) await sleep(config.pageDelayMs);
      }
      const extracted = extractListPage(pageDoc, pageUrl);
      if (!extracted.entries.length) warnings.push(`ページ ${pn}: 一覧行を取得できませんでした。`);
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

    let detailsFetched = 0;
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
          for (const [k, v] of Object.entries(parsed.detailFields)) mergeValue(entry.data, k, v);
          detailsFetched += 1;
        } catch (err) {
          entry.data["詳細_取得エラー"] = normalizeText(err?.message || "詳細取得エラー");
        }
        if (config.detailDelayMs > 0) await sleep(config.detailDelayMs);
      }
    }

    return {
      ok: true,
      customers: dedupedEntries.map((e) => e.data),
      reservations: [],
      meta: { pagesFetched, detailsFetched, detectedTotalPages, currentPage },
      warnings,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
