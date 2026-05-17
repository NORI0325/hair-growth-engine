import type { Page } from "playwright";
import { logger } from "../logger.js";

export interface DayReservation {
  external_reservation_id: string | null;
  date: string; // YYYYMMDD
  time: string | null; // HH:MM
  end_time?: string | null;
  duration_minutes?: number | null;
  customerName: string | null;
  menu: string | null;
  stylistName: string | null;
  raw: string;
  detail_href?: string | null;
  detail_url?: string | null;
  time_source?: "popup" | "detail" | "not_fetched_limit" | null;
  detail_fetch_skipped_reason?: string | null;
  detail_fetch_error?: string | null;
}

// 1日あたりの詳細ページ展開上限（CAPTCHAリスク低減・サロンボード負荷軽減）
const DETAIL_FETCH_DAILY_LIMIT = 10;

const SCHEDULE_URLS = [
  (d: string) => `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=${d}`,
  (d: string) => `https://salonboard.com/CLP/bt/schedule/salonScheduleDay/?date=${d}`,
];

function expectedDateLabel(yyyymmdd: string): string {
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${m}月${d}日`;
}

function isErrorPage(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("指定されたurlは存在しません") ||
    lower.includes("ページが見つかりません") ||
    lower.includes("not found");
}

async function navigateToDate(page: Page, date: string): Promise<boolean> {
  const want = expectedDateLabel(date);
  for (const build of SCHEDULE_URLS) {
    const url = build(date);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      if (/\/login/i.test(page.url())) return false;
      const body = await page.locator("body").innerText().catch(() => "");
      if (!isErrorPage(body) && (body.includes(want) || body.includes("予約"))) return true;
    } catch (e) {
      logger.warn({ url, e: e instanceof Error ? e.message : String(e) }, "listDayReservations: nav failed");
    }
  }
  return false;
}

export async function listDayReservations(page: Page, date: string): Promise<DayReservation[]> {
  logger.info({ date }, "listDayReservations: start");
  const ok = await navigateToDate(page, date);
  if (/\/login/i.test(page.url())) throw new Error("session_expired_in_list");
  if (!ok) {
    logger.warn({ url: page.url() }, "listDayReservations: page not matched");
    return [];
  }

  // 予約ブロック候補を収集（顧客名「様」を含む最も内側の要素 → クリック可能な親）
  const candidates = await page.evaluate(() => {
    const ACTION_TEXTS = new Set([
      "詳細", "変更", "予約登録", "キャンセル", "メモ編集", "お客様情報",
      "カルテ", "受付チェック", "会計", "新規予約", "予約", "コピー", "削除",
      "予約一覧", "一括停止・再開", "確定", "スケジュール", "毎月の受付設定",
      "アラート", "印刷", "アイコン説明", "最新を表示",
    ]);
    const all = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
    const hits: HTMLElement[] = [];
    for (const el of all) {
      const own = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!own) continue;
      if (!/様(?:\s|$|（|\()/.test(own)) continue;
      if (ACTION_TEXTS.has(own)) continue;
      hits.push(el);
    }
    const set = new Set(hits);
    const innermost = hits.filter((h) => {
      for (const c of Array.from(h.querySelectorAll("*"))) if (set.has(c as HTMLElement)) return false;
      return true;
    });
    const out: any[] = [];
    let idx = 0;
    for (const hit of innermost.slice(0, 80)) {
      const parents: HTMLElement[] = [];
      let cur: HTMLElement | null = hit;
      for (let i = 0; i < 6 && cur; i++) { parents.push(cur); cur = cur.parentElement; }
      let chosen: HTMLElement | null = null;
      for (const p of parents) {
        const rect = p.getBoundingClientRect();
        const cls = (p.className || "").toString().toLowerCase();
        const hasOnclick = !!p.getAttribute("onclick");
        const hasReserveClass = /schedule|reserve|appoint|panel|item|box|sch_|reserved/.test(cls);
        const bigEnough = rect.width >= 60 && rect.height >= 20;
        if ((hasOnclick || hasReserveClass) && bigEnough) { chosen = p; break; }
      }
      if (!chosen) chosen = hit;
      const attr = `data-sb-list-idx`;
      chosen.setAttribute(attr, String(idx));
      out.push({
        idx,
        text: (chosen.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
      });
      idx++;
    }
    return out;
  }).catch((e) => {
    logger.warn({ e: e instanceof Error ? e.message : String(e) }, "listDayReservations: candidate eval failed");
    return [] as any[];
  });

  logger.info({ candidateCount: candidates.length }, "listDayReservations: candidates found");

  const seen = new Set<string>();
  const results: DayReservation[] = [];

  for (const cand of candidates) {
    try {
      const sel = `[data-sb-list-idx="${cand.idx}"]`;
      if ((await page.locator(sel).count()) === 0) continue;

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(120);

      const target = page.locator(sel).first();
      await target.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      await target.click({ force: true, timeout: 2500 }).catch(() => {});

      const popupAppeared = await page
        .waitForSelector("#reserveItemName, .reserveCustomerName", { timeout: 2500, state: "visible" })
        .then(() => true).catch(() => false);
      if (!popupAppeared) continue;

      const popupData = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s);
        const txt = (s: string) => {
          const el = q(s) as HTMLElement | null;
          return el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "";
        };
        const reserveCustomerName = txt(".reserveCustomerName") || txt("#reserveItemName");
        const popupRoot =
          (q("#reserveItemName")?.closest(".mod_column02, .mod_box_01, .modalContents, .pop, [class*='popup' i]") as HTMLElement | null) ||
          (q(".reserveCustomerName")?.closest(".mod_column02, .mod_box_01, .modalContents, .pop, [class*='popup' i]") as HTMLElement | null);
        const popupText = popupRoot ? (popupRoot.innerText || "").replace(/\s+/g, " ").trim() : "";

        const findBtn = (label: string) => {
          for (const el of Array.from(document.querySelectorAll("a, button"))) {
            const t = ((el as HTMLElement).innerText || el.textContent || "").trim();
            if (t === label) return {
              href: (el as HTMLAnchorElement).getAttribute("href") || "",
              onclick: el.getAttribute("onclick") || "",
            };
          }
          return null;
        };
        const detailBtn = findBtn("詳細");
        const detailHref = detailBtn?.href || "";
        const changeBtn = findBtn("変更");
        const combined = `${detailBtn?.href || ""} ${detailBtn?.onclick || ""} ${changeBtn?.href || ""} ${changeBtn?.onclick || ""}`;
        const m =
          combined.match(/(?:rsvId|reserveId|reserve_id|reservationId)['"=:\s]+([A-Z0-9]+)/i) ||
          combined.match(/\/(BE\d{6,})/i) ||
          combined.match(/['"]([A-Z0-9]{8,})['"]/);
        const extractedReserveId = m ? m[1] : null;

        return { reserveCustomerName, popupText: popupText.slice(0, 1000), extractedReserveId, detailHref };
      }).catch(() => null);

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(80);

      if (!popupData?.reserveCustomerName) continue;
      const customerName = (popupData.reserveCustomerName.match(/^([^（(]+?)(?:[（(][^）)]*[）)])?\s*様/)?.[1] || "").trim() || null;
      const popupText = popupData.popupText || "";
      const timeMatch = popupText.match(/(\d{1,2}):(\d{2})/) || (cand.text || "").match(/(\d{1,2}):(\d{2})/);
      const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null;

      const dedupeKey = popupData.extractedReserveId || `${customerName}|${time}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      results.push({
        external_reservation_id: popupData.extractedReserveId,
        date,
        time,
        customerName,
        menu: null,
        stylistName: null,
        raw: popupText.slice(0, 300),
        detail_href: popupData.detailHref || null,
        time_source: time ? "popup" : null,
      });
    } catch (e) {
      logger.warn({ idx: cand.idx, e: e instanceof Error ? e.message : String(e) }, "listDayReservations: cand failed");
    }
  }

  // ===== P2: time === null の予約だけ詳細ページ (/net/reserveDetail) を直列で開き #rsvDate から補完 =====
  // ext/extReserveDetail はサンプル未確認のため未対応。
  let detailFetched = 0;
  for (const r of results) {
    if (r.time) continue;
    const href = r.detail_href || "";
    if (!href || !/\/net\/reserveDetail/.test(href)) continue;
    if (detailFetched >= DETAIL_FETCH_DAILY_LIMIT) {
      r.time_source = "not_fetched_limit";
      r.detail_fetch_skipped_reason = "daily_detail_fetch_limit";
      continue;
    }
    detailFetched += 1;
    const detailUrl = href.startsWith("http") ? href : `https://salonboard.com${href}`;
    r.detail_url = detailUrl;
    try {
      await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      if (/\/login/i.test(page.url())) {
        r.detail_fetch_error = "session_expired";
        break; // セッション切れ後は他も失敗するため打ち切り
      }
      const body = await page.locator("body").innerText().catch(() => "");
      if (/画像認証|キャプチャ|captcha|reCAPTCHA/i.test(body)) {
        r.detail_fetch_error = "captcha_required";
        break; // 自動リトライしない
      }
      const rsvDateText = await page.locator("#rsvDate").first().innerText().catch(() => "");
      if (!rsvDateText) {
        r.detail_fetch_error = "rsvDate_not_found";
        continue;
      }
      // 例: "2026年5月23日（土）12:00 ～ 14:30  施術時間[ 02:30 ]  施術目安時間[ 02:30 ]"
      const timeRange = rsvDateText.match(/(\d{1,2}):(\d{2})\s*[～~〜\-]\s*(\d{1,2}):(\d{2})/);
      const durMatch = rsvDateText.match(/施術時間\s*[\[［]\s*(\d{1,2}):(\d{2})\s*[\]］]/);
      if (timeRange) {
        const startT = `${timeRange[1].padStart(2, "0")}:${timeRange[2]}`;
        const endT = `${timeRange[3].padStart(2, "0")}:${timeRange[4]}`;
        r.time = startT;
        r.end_time = endT;
        r.time_source = "detail";
        if (durMatch) r.duration_minutes = parseInt(durMatch[1], 10) * 60 + parseInt(durMatch[2], 10);
        else {
          const sh = parseInt(timeRange[1], 10), sm = parseInt(timeRange[2], 10);
          const eh = parseInt(timeRange[3], 10), em = parseInt(timeRange[4], 10);
          r.duration_minutes = (eh * 60 + em) - (sh * 60 + sm);
        }
      } else {
        r.detail_fetch_error = "rsvDate_not_found";
      }
    } catch (e) {
      r.detail_fetch_error = "detail_fetch_error";
      logger.warn({ href, e: e instanceof Error ? e.message : String(e) }, "listDayReservations: detail fetch failed");
    }
    await page.waitForTimeout(500); // サロンボード負荷軽減
  }

  logger.info({ count: results.length, detailFetched }, "listDayReservations: done");
  return results;
}
