import type { Page } from "playwright";
import { WorkerError, detectErrorFromPage } from "../errorMapper.js";

export interface UpdateReservationInput {
  external_reservation_id: string; // 例: "BE89577087"
  // 変更したい値（指定したものだけ反映）
  date?: string;          // YYYYMMDD
  time?: string;          // HHMM
  stylistId?: string;
  rsvTerm?: string;
  operationMemo?: string; // 次回来店向けメモ
}

/**
 * 予約変更画面はスケジュール画面のポップアップから「変更」を踏むのが正規ルートだが、
 * 直接URL: /CLP/bt/reserve/net/instantReserveChangeInput/?reserveId=XXXX が使える場合が多い。
 * もしダメなら一覧経由にフォールバック。
 */
export async function updateReservation(page: Page, input: UpdateReservationInput) {
  const directUrl = `https://salonboard.com/CLP/bt/reserve/net/instantReserveChangeInput/?reserveId=${input.external_reservation_id}`;
  await page.goto(directUrl, { waitUntil: "domcontentloaded" });

  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login");
  }

  // 変更画面の存在確認
  if (!(await page.locator('form#tmpReserveChange').count())) {
    throw new WorkerError("mapping_not_found", "reservation not found or change form missing");
  }

  if (input.stylistId) {
    await page.locator('select[name="stylistId"]').selectOption(input.stylistId);
  }
  if (input.time) {
    await page.locator('select[name="rsvTime"]').selectOption(input.time);
  }
  if (input.rsvTerm) {
    await page.locator('select[name="rsvTerm"]').selectOption(input.rsvTerm);
  }
  if (input.operationMemo !== undefined) {
    await page.locator('textarea[name="operationMemo"]').fill(input.operationMemo);
  }

  // 「変更する」押下
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator('a#mailEntry').click(),
  ]);

  const finalUrl = page.url();
  const finalText = await page.locator("body").innerText().catch(() => "");
  const detected = detectErrorFromPage({ url: finalUrl, bodyText: finalText });
  if (detected) throw new WorkerError(detected, `update failed: ${detected}`);

  if (!/変更しました|完了/.test(finalText)) {
    throw new WorkerError("external_site_changed", "update completion text not found");
  }
  return { external_reservation_id: input.external_reservation_id };
}
