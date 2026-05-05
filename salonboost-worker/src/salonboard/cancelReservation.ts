import type { Page } from "playwright";
import { WorkerError, detectErrorFromPage } from "../errorMapper.js";

export interface CancelReservationInput {
  external_reservation_id: string;
  date: string;        // YYYYMMDD（スケジュール画面遷移用）
  stylistId?: string;
  noShow?: boolean;    // true = 無断キャンセル
}

/**
 * キャンセルはスケジュール画面のポップアップ経由。
 * 1) スケジュール画面を開く
 * 2) 該当予約のセルをクリック → ポップアップ表示
 * 3) [キャンセル] タブ (#reserveItemCancelButton) クリック
 * 4) 確認ダイアログで [キャンセルにする] or [無断キャンセルにする] クリック
 */
export async function cancelReservation(page: Page, input: CancelReservationInput) {
  const stylistId = input.stylistId ?? "0000000000";
  const scheduleUrl = `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=${input.date}&stylistId=${stylistId}`;
  await page.goto(scheduleUrl, { waitUntil: "domcontentloaded" });

  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login");
  }

  // 該当予約セルを探す（reserveId属性 or data属性で識別）
  const reserveId = input.external_reservation_id;
  const cell = page.locator(`[data-reserve-id="${reserveId}"], [id*="${reserveId}"], a:has-text("${reserveId}")`).first();
  if (!(await cell.count())) {
    throw new WorkerError("mapping_not_found", `reservation cell not found: ${reserveId}`);
  }
  await cell.click();

  // ポップアップ内の「キャンセル」タブ
  const cancelTab = page.locator('#reserveItemCancelButton');
  await cancelTab.waitFor({ state: "visible", timeout: 8000 });
  await cancelTab.click();

  // 確認ダイアログ：通常 / 無断
  const targetBtnText = input.noShow ? "無断キャンセルにする" : "キャンセルにする";
  const confirmBtn = page.locator(`a:has-text("${targetBtnText}")`).first();
  await confirmBtn.waitFor({ state: "visible", timeout: 8000 });

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    confirmBtn.click(),
  ]);

  // 完了判定（ページ再読込 or アラート）
  await page.waitForTimeout(1500);
  const finalUrl = page.url();
  const finalText = await page.locator("body").innerText().catch(() => "");
  const detected = detectErrorFromPage({ url: finalUrl, bodyText: finalText });
  if (detected) throw new WorkerError(detected, `cancel failed: ${detected}`);

  return { external_reservation_id: reserveId, no_show: !!input.noShow };
}
