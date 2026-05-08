import type { Page } from "playwright";
import { logger } from "../logger.js";

export interface FindReservationInput {
  // YYYYMMDD
  date: string;
  // HHMM (e.g. "1500") — 任意。指定なければ当日の全件返す
  time?: string | number;
  // 顧客名（漢字 or カナ）— 部分一致
  customerName?: string;
  // 担当 stylistId — "0000000000" は指名なし
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
 * サロンボードのスケジュール画面から、指定日の予約一覧を取得し、
 * 条件で絞り込んで返す。
 * （登録は一切行わない・読み取り専用）
 */
export async function findReservations(
  page: Page,
  input: FindReservationInput,
): Promise<FoundReservation[]> {
  const url = `https://salonboard.com/CLP/bt/schedule/?date=${input.date}`;
  logger.info({ url }, "findReservations: navigate");
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // ログアウト判定
  if (/\/login/i.test(page.url())) {
    throw new Error("session_expired_in_find");
  }

  // スケジュール表のセル <a href*="extReserveDetail"> を全て収集
  const items = await page.$$eval('a[href*="extReserveDetail"], a[href*="reserveDetail"]', (els) =>
    els.map((e) => {
      const a = e as HTMLAnchorElement;
      const href = a.getAttribute("href") || "";
      const txt = (a.textContent || "").trim();
      const m = href.match(/(?:rsvId|reserveId|reserve_id)=([A-Z0-9]+)/i);
      // 親行から time / stylist を推測
      const row = a.closest("tr,td,div");
      const rowText = (row?.textContent || "").replace(/\s+/g, " ").trim();
      return { href, text: txt, reserveId: m?.[1] ?? null, rowText };
    }),
  ).catch(() => []);

  logger.info({ count: items.length }, "findReservations: raw items");

  const wantTime = input.time != null ? String(input.time).padStart(4, "0") : null;
  const wantTimeFmt = wantTime ? `${wantTime.slice(0, 2)}:${wantTime.slice(2, 4)}` : null;
  const wantName = input.customerName?.trim() || null;

  const results: FoundReservation[] = items.map((it) => ({
    external_reservation_id: it.reserveId,
    date: input.date,
    time: extractTime(it.rowText),
    stylistName: null,
    customerName: extractName(it.rowText),
    menu: null,
    raw: it.rowText.slice(0, 300),
  }));

  return results.filter((r) => {
    if (wantTimeFmt && r.time && r.time !== wantTimeFmt) return false;
    if (wantName && r.customerName && !r.customerName.includes(wantName) && !wantName.includes(r.customerName)) return false;
    return true;
  });
}

function extractTime(text: string): string | null {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function extractName(text: string): string | null {
  // 「予約登録」「キャンセル」などのナビ文言を除去
  const cleaned = text.replace(/予約登録|キャンセル|変更|詳細|新規/g, "").trim();
  if (cleaned.length > 60) return cleaned.slice(0, 60);
  return cleaned || null;
}
