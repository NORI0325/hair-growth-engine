import type { Page } from "playwright";
import { logger } from "../logger.js";

export interface FindReservationInput {
  date: string;                       // YYYYMMDD
  time?: string | number;             // HHMM
  customerName?: string;
  stylistId?: string | number;
}

export interface FoundReservation {
  external_reservation_id: string | null;
  date: string;
  time: string | null;
  stylistName: string | null;
  customerName: string | null;
  menu: string | null;
  raw: string;
}

/**
 * サロンボードのスケジュール画面から、指定日の予約を読み取り専用で検索。
 * 予約セルには通常 onclick="javascript:..." または anchor href が含まれる。
 * パースが店舗UIにより変わるため、複数セレクタ + 多めのログを出す。
 */
export async function findReservations(
  page: Page,
  input: FindReservationInput,
): Promise<FoundReservation[]> {
  const url = `https://salonboard.com/CLP/bt/schedule/?date=${input.date}`;
  logger.info({ url, input }, "findReservations: navigate");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  if (/\/login/i.test(page.url())) {
    throw new Error("session_expired_in_find");
  }

  const title = await page.title().catch(() => "");
  const bodySnippet = await page.locator("body").innerText().then((t) => t.slice(0, 600)).catch(() => "");
  logger.info({ url: page.url(), title, bodySnippet }, "findReservations: page loaded");

  // セレクタごとの候補数をログ
  const counts = await page.evaluate(() => {
    const sel = (s: string) => document.querySelectorAll(s).length;
    return {
      anchorExtDetail: sel('a[href*="extReserveDetail"]'),
      anchorReserveDetail: sel('a[href*="reserveDetail"]'),
      anchorRsvId: sel('a[href*="rsvId="]'),
      anchorReserveId: sel('a[href*="reserveId="]'),
      onclickRsv: sel('[onclick*="rsvId"], [onclick*="reserveId"]'),
      tdReserved: sel("td.reserved, td.rsv, td.fcReserved"),
      tdAny: sel("td"),
    };
  }).catch(() => null);
  logger.info({ counts }, "findReservations: selector counts");

  // 予約候補を抽出: anchor + onclick + td
  const items = await page.evaluate(() => {
    const results: Array<{ reserveId: string | null; href: string | null; onclick: string | null; rowText: string; cellText: string }> = [];
    const pushFromEl = (el: Element) => {
      const href = (el as HTMLAnchorElement).getAttribute?.("href") || null;
      const onclick = el.getAttribute("onclick") || null;
      const combined = `${href || ""} ${onclick || ""}`;
      const m = combined.match(/(?:rsvId|reserveId|reserve_id)['"=:\s]+([A-Z0-9]+)/i);
      const cellText = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      const row = el.closest("tr,td,div");
      const rowText = ((row as HTMLElement | null)?.innerText || row?.textContent || "").replace(/\s+/g, " ").trim();
      results.push({ reserveId: m?.[1] ?? null, href, onclick, rowText, cellText });
    };
    document.querySelectorAll('a[href*="extReserveDetail"], a[href*="reserveDetail"], a[href*="rsvId="], a[href*="reserveId="]').forEach(pushFromEl);
    document.querySelectorAll('[onclick*="rsvId"], [onclick*="reserveId"], [onclick*="reserve_id"]').forEach(pushFromEl);
    document.querySelectorAll("td.reserved, td.rsv, td.fcReserved").forEach(pushFromEl);
    return results;
  }).catch(() => [] as Array<{ reserveId: string | null; href: string | null; onclick: string | null; rowText: string; cellText: string }>);

  logger.info({ rawCount: items.length }, "findReservations: raw candidates");
  for (const [i, it] of items.slice(0, 8).entries()) {
    logger.info({
      idx: i,
      reserveId: it.reserveId,
      href: it.href?.slice(0, 120),
      onclick: it.onclick?.slice(0, 120),
      cellText: it.cellText.slice(0, 100),
      rowText: it.rowText.slice(0, 200),
    }, "findReservations: candidate");
  }

  const wantTime = input.time != null ? String(input.time).padStart(4, "0") : null;
  const wantTimeFmt = wantTime ? `${wantTime.slice(0, 2)}:${wantTime.slice(2, 4)}` : null;
  const wantName = input.customerName?.trim() || null;

  // 重複除去 (reserveId or rowText)
  const seen = new Set<string>();
  const unique = items.filter((it) => {
    const k = it.reserveId || it.rowText.slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const parsed: FoundReservation[] = unique.map((it) => {
    const time = extractTime(it.rowText) || extractTime(it.cellText);
    const customerName = extractName(it.rowText) || extractName(it.cellText);
    return {
      external_reservation_id: it.reserveId,
      date: input.date,
      time,
      stylistName: null,
      customerName,
      menu: null,
      raw: (it.rowText || it.cellText).slice(0, 300),
    };
  });

  logger.info({
    parsedCount: parsed.length,
    extractedTimes: parsed.map((p) => p.time).slice(0, 8),
    extractedNames: parsed.map((p) => p.customerName).slice(0, 8),
    extractedIds: parsed.map((p) => p.external_reservation_id).slice(0, 8),
  }, "findReservations: parsed");

  const filtered = parsed.filter((r) => {
    if (wantTimeFmt && r.time && r.time !== wantTimeFmt) return false;
    if (wantName && r.customerName) {
      const a = normalize(r.customerName);
      const b = normalize(wantName);
      if (!a.includes(b) && !b.includes(a)) return false;
    }
    return true;
  });

  logger.info({ count: filtered.length, wantTimeFmt, wantName }, "findReservations: filtered result");
  return filtered;
}

function normalize(s: string): string {
  return s.replace(/[\s　]/g, "").toLowerCase();
}

function extractTime(text: string): string | null {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function extractName(text: string): string | null {
  const cleaned = text
    .replace(/予約登録|キャンセル|変更|詳細|新規|空き|休み|休業|ブロック/g, "")
    .replace(/\d{1,2}:\d{2}/g, "")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > 60) return cleaned.slice(0, 60);
  return cleaned;
}
