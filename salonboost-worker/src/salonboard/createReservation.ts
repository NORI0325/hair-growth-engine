import type { Page } from "playwright";
import { WorkerError, detectErrorFromPage } from "../errorMapper.js";
import { logger } from "../logger.js";

export interface CreateReservationInput {
  // YYYYMMDD
  date: string;
  // HHMM (e.g. "1500")
  time: string;
  stylistId: string;          // "0000000000" = 指名なし
  rsvTerm: string;            // 分単位 (e.g. "90")
  rsvRouteId?: string;        // 予約経路
  setmenuId?: string;
  menuCategoryCdList?: string[];
  menuIdList?: string[];
  netCouponId?: string;
  nmSei: string;
  nmMei: string;
  nmSeiKana: string;
  nmMeiKana: string;
  tel: string;
  tel2?: string;
  customerNo?: string;
  rsvEtc?: string;
  rsvTypeCdBool?: boolean;    // 来店時間枠で予約
}

const FORM_URL = "https://salonboard.com/CLP/bt/reserve/ext/extReserveRegist/";

export async function createReservation(page: Page, input: CreateReservationInput) {
  // 新規予約フォームへ遷移
  // URL構築: /CLP/bt/reserve/ext/extReserveRegistInput/?date=YYYYMMDD&time=HHMM&stylistId=...
  const inputUrl = `https://salonboard.com/CLP/bt/reserve/ext/extReserveRegistInput/?date=${input.date}&time=${input.time}&stylistId=${input.stylistId}`;
  await page.goto(inputUrl, { waitUntil: "domcontentloaded" });

  await assertNotLoggedOut(page);

  // 必須項目入力
  if (await page.locator('select[name="stylistId"]').count()) {
    await page.locator('select[name="stylistId"]').selectOption(input.stylistId);
  }
  if (await page.locator('select[name="time"]').count()) {
    await page.locator('select[name="time"]').selectOption(input.time);
  }
  await page.locator('select[name="rsvTerm"]').selectOption(input.rsvTerm);

  if (input.rsvRouteId && await page.locator('select[name="rsvRouteId"]').count()) {
    await page.locator('select[name="rsvRouteId"]').selectOption(input.rsvRouteId);
  }
  if (input.setmenuId && await page.locator('select[name="setmenuId"]').count()) {
    await page.locator('select[name="setmenuId"]').selectOption(input.setmenuId);
  }
  if (input.menuCategoryCdList && await page.locator('select[name="menuCategoryCdList"]').count()) {
    await page.locator('select[name="menuCategoryCdList"]').selectOption(input.menuCategoryCdList);
  }
  if (input.menuIdList && await page.locator('select[name="menuIdList"]').count()) {
    await page.locator('select[name="menuIdList"]').selectOption(input.menuIdList);
  }
  if (input.netCouponId && await page.locator('select[name="netCouponId"]').count()) {
    await page.locator('select[name="netCouponId"]').selectOption(input.netCouponId);
  }

  await page.locator('input[name="nmSeiKana"]').fill(input.nmSeiKana);
  await page.locator('input[name="nmMeiKana"]').fill(input.nmMeiKana);
  await page.locator('input[name="nmSei"]').fill(input.nmSei);
  await page.locator('input[name="nmMei"]').fill(input.nmMei);
  await page.locator('input[name="tel"]').fill(input.tel);
  if (input.tel2) await page.locator('input[name="tel2"]').fill(input.tel2);
  if (input.customerNo) await page.locator('input[name="customerNo"]').fill(input.customerNo);
  if (input.rsvEtc) await page.locator('textarea[name="rsvEtc"]').fill(input.rsvEtc);

  if (input.rsvTypeCdBool) {
    const cb = page.locator('input[name="rsvTypeCdBool"]');
    if (await cb.count()) await cb.check().catch(() => {});
  }

  // 登録ボタン押下
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator('a#regist').click(),
  ]);

  // 確認画面が出る場合 → 「登録する」を押す
  const confirmBtn = page.locator('a#regist, a.mod_btn_entry_08').first();
  if (await confirmBtn.count() && /\/extReserveRegistConfirm|確認/.test(page.url() + (await page.locator("body").innerText().catch(() => "")))) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      confirmBtn.click().catch(() => {}),
    ]);
  }

  // 完了判定
  const finalUrl = page.url();
  const finalText = await page.locator("body").innerText().catch(() => "");

  const detected = detectErrorFromPage({ url: finalUrl, bodyText: finalText });
  if (detected) throw new WorkerError(detected, `create failed: ${detected}`);

  if (!/登録しました|完了/.test(finalText)) {
    logger.warn({ finalUrl, snippet: finalText.slice(0, 300) }, "create result unclear");
    throw new WorkerError("external_site_changed", "create completion text not found");
  }

  // 予約番号抽出（あれば）
  const m = finalText.match(/(BE\d{6,})/);
  return { external_reservation_id: m?.[1] ?? null };
}

async function assertNotLoggedOut(page: Page) {
  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login");
  }
}
