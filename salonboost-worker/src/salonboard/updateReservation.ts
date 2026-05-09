import type { Page } from "playwright";
import { WorkerError, detectErrorFromPage } from "../errorMapper.js";

export interface UpdateReservationInput {
  external_reservation_id: string;
  date?: string;          // YYYYMMDD（参照用、変更画面では基本不要）
  time?: string;          // HHMM
  stylistId?: string;
  rsvTerm?: string | number;
  operationMemo?: string;
  customerName?: string;  // ログ用
}

/**
 * 予約変更画面に直接遷移して更新する。
 * net 予約以外は instantReserveChangeInput が開かない場合があるため、
 * 開けない時は mapping_not_found を返して needs_review に落とす。
 */
export async function updateReservation(page: Page, input: UpdateReservationInput) {
  const reserveId = input.external_reservation_id;
  const directUrl = `https://salonboard.com/CLP/bt/reserve/net/instantReserveChangeInput/?reserveId=${reserveId}`;
  console.log("[updateReservation] goto", { directUrl, time: input.time, rsvTerm: input.rsvTerm, stylistId: input.stylistId });
  await page.goto(directUrl, { waitUntil: "domcontentloaded" });

  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login");
  }

  // 変更画面の存在確認
  const formCount = await page.locator('form#tmpReserveChange').count();
  if (formCount === 0) {
    // 画面エラーを優先判定
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const detected = detectErrorFromPage({ url: page.url(), bodyText });
    if (detected) throw new WorkerError(detected, `update form unavailable: ${detected}`);
    throw new WorkerError("mapping_not_found", `reservation ${reserveId} not found or change form unavailable`);
  }

  if (input.stylistId) {
    try {
      await page.locator('select[name="stylistId"]').selectOption(input.stylistId);
    } catch (e) {
      throw new WorkerError("mapping_not_found", `stylistId ${input.stylistId} not selectable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (input.time) {
    const t = String(input.time).padStart(4, "0");
    try {
      await page.locator('select[name="rsvTime"]').selectOption(t);
    } catch (e) {
      throw new WorkerError("invalid_time", `time ${t} not selectable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (input.rsvTerm !== undefined && input.rsvTerm !== null && String(input.rsvTerm) !== "") {
    try {
      await page.locator('select[name="rsvTerm"]').selectOption(String(input.rsvTerm));
    } catch (e) {
      throw new WorkerError("invalid_time", `rsvTerm ${input.rsvTerm} not selectable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (input.operationMemo !== undefined) {
    await page.locator('textarea[name="operationMemo"]').fill(input.operationMemo).catch(() => {});
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
  return { external_reservation_id: reserveId };
}
