import type { Page } from "playwright";
import { WorkerError, detectErrorFromPage } from "../errorMapper.js";
import { findReservations } from "./findReservation.js";
import { logger } from "../logger.js";

export interface CancelReservationInput {
  external_reservation_id: string;
  date: string;        // YYYYMMDD
  time?: string | null;     // HHMM
  stylistId?: string;
  customerName?: string | null;
  noShow?: boolean;
}

/**
 * キャンセル手順:
 * 1) 予約表で対象予約セルを探してクリック → ポップアップ表示
 * 2) ポップアップ上部の #reserveItemCancelButton (「キャンセル」) をクリック
 * 3) 確認ダイアログで「はい」をクリック
 */
export async function cancelReservation(page: Page, input: CancelReservationInput) {
  const stylistId = input.stylistId ?? "0000000000";
  const reserveId = input.external_reservation_id;

  // まず findReservations と同じ方式で対象予約のポップアップを開く
  // findReservations 内部で popup を開いて Escape で閉じてしまうので、
  // 同じ方式でナビゲートし、独自に再度クリックしてポップアップを開く。
  const found = await findReservations(page, {
    date: input.date,
    time: input.time ?? undefined,
    customerName: input.customerName ?? undefined,
    stylistId,
  });

  // ターゲット候補（external_reservation_id が一致するもの）
  const target = found.find((r) => r.external_reservation_id === reserveId) ?? found[0];

  if (!target) {
    // フォールバック: data属性での直接探索
    const cell = page.locator(`[data-reserve-id="${reserveId}"], [id*="${reserveId}"]`).first();
    if (!(await cell.count())) {
      throw new WorkerError("mapping_not_found", `reservation cell not found: ${reserveId} (name=${input.customerName ?? "-"})`);
    }
    await cell.click({ force: true });
  } else {
    // findReservations が data-sb-find-idx を残してくれているのでそれを再利用
    // ただし Escape で閉じられているので顧客名で再度開く
    if (input.customerName) {
      const nameLoc = page.locator(`text=${input.customerName}`).first();
      if (await nameLoc.count()) {
        await nameLoc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await nameLoc.click({ force: true, timeout: 3000 }).catch(() => {});
      }
    }
  }

  // ポップアップが visible になるのを待つ
  const cancelBtn = page.locator('#reserveItemCancelButton, a.btn_schedule_cancel').first();
  const visible = await cancelBtn.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  if (!visible) {
    const bodySnippet = await page.locator("body").innerText().catch(() => "");
    logger.warn({ reserveId, bodySnippet: bodySnippet.slice(0, 500) }, "cancelReservation: cancel button not visible");
    throw new WorkerError("unknown_error", "cancel button not visible in popup");
  }

  await cancelBtn.click();

  // 確認ダイアログ「予約をキャンセルにします。よろしいですか？」→ 「はい」
  const yesBtn = page.locator('a:has-text("はい"), button:has-text("はい")').first();
  const yesVisible = await yesBtn.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  if (!yesVisible) {
    // フォールバック: 旧文言
    const alt = page.locator(`a:has-text("キャンセルにする"), a:has-text("無断キャンセルにする")`).first();
    if (await alt.count()) {
      await alt.click();
    } else {
      const bodySnippet = await page.locator("body").innerText().catch(() => "");
      logger.warn({ bodySnippet: bodySnippet.slice(0, 500) }, "cancelReservation: confirm dialog not found");
      throw new WorkerError("unknown_error", "cancel confirm dialog not found");
    }
  } else {
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      yesBtn.click(),
    ]);
  }

  await page.waitForTimeout(1500);
  const finalUrl = page.url();
  const finalText = await page.locator("body").innerText().catch(() => "");
  const detected = detectErrorFromPage({ url: finalUrl, bodyText: finalText });
  if (detected) throw new WorkerError(detected, `cancel failed: ${detected}`);

  logger.info({ reserveId, customerName: input.customerName }, "cancelReservation: success");
  return { external_reservation_id: reserveId, no_show: !!input.noShow };
}
