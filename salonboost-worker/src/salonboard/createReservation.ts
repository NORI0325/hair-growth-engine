import type { Page } from "playwright";
import { WorkerError, detectErrorFromPage } from "../errorMapper.js";
import { logger } from "../logger.js";

export interface CreateReservationInput {
  // YYYYMMDD
  date: string;
  // HHMM (e.g. "1500")
  time: string | number;
  stylistId: string | number;          // "0000000000" = 指名なし
  rsvTerm: string | number;            // 分単位 (e.g. "90")
  rsvRouteId?: string | number;        // 予約経路
  setmenuId?: string | number;
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
const SCHEDULE_URL = "https://salonboard.com/CLP/bt/schedule/";

async function dumpPageDiag(page: Page, label: string) {
  try {
    const url = page.url();
    const title = await page.title().catch(() => "");
    const body = await page.locator("body").innerText().catch(() => "");
    const forms = await page.$$eval("form", (els) =>
      els.map((e) => ({ id: (e as HTMLFormElement).id, action: (e as HTMLFormElement).action })),
    ).catch(() => []);
    const selects = await page.$$eval("select", (els) =>
      els.map((e) => (e as HTMLSelectElement).name || (e as HTMLSelectElement).id),
    ).catch(() => []);
    const inputs = await page.$$eval("input", (els) =>
      els.map((e) => `${(e as HTMLInputElement).type}:${(e as HTMLInputElement).name || (e as HTMLInputElement).id}`),
    ).catch(() => []);
    const reserveLinks = await page.$$eval('a', (els) =>
      els.filter((e) => /予約登録/.test(e.textContent || "")).map((e) => ({
        id: (e as HTMLAnchorElement).id, href: (e as HTMLAnchorElement).getAttribute("href"),
      })),
    ).catch(() => []);
    let screenshotPath: string | null = null;
    try {
      screenshotPath = `/tmp/sb-${label}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch { screenshotPath = null; }
    logger.warn({
      label, url, title, snippet: body.slice(0, 400),
      forms, selects, inputs, reserveLinks, screenshotPath,
    }, "page diagnostic");
  } catch (e) {
    logger.warn({ e: e instanceof Error ? e.message : String(e) }, "dumpPageDiag failed");
  }
}

async function gotoReservationForm(page: Page, input: CreateReservationInput) {
  const directUrl = `${FORM_URL}?date=${input.date}&time=${input.time}&stylistId=${input.stylistId}`;
  logger.info({ directUrl }, "navigating to reservation form (direct URL)");
  await page.goto(directUrl, { waitUntil: "domcontentloaded" }).catch((e) => {
    logger.warn({ e: e instanceof Error ? e.message : String(e) }, "direct goto failed, will try via schedule");
  });
  await assertNotLoggedOut(page);

  // 予約登録画面に到達したかチェック（rsvTerm等のいずれかが見えればOK）
  const formMarker = page.locator(
    '#rsvTermId, select[name="rsvTerm"], select[name="setmenuId"], input[name="nmSei"]',
  ).first();
  try {
    await formMarker.waitFor({ state: "attached", timeout: 15000 });
    return;
  } catch {
    logger.warn({ url: page.url(), title: await page.title().catch(() => "") }, "direct URL did not reach reservation form, trying schedule fallback");
  }

  // フォールバック: スケジュール画面 → #extReserve form を submit
  await page.goto(SCHEDULE_URL, { waitUntil: "domcontentloaded" });
  await assertNotLoggedOut(page);

  const submitted = await page.evaluate(({ date, time, stylistId }) => {
    const f = document.querySelector('#extReserve') as HTMLFormElement | null;
    if (!f) return false;
    const set = (n: string, v: string) => {
      let el = f.querySelector(`input[name="${n}"]`) as HTMLInputElement | null;
      if (!el) {
        el = document.createElement("input");
        el.type = "hidden"; el.name = n;
        f.appendChild(el);
      }
      el.value = v;
    };
    set("date", String(date));
    set("time", String(time));
    set("stylistId", String(stylistId));
    f.submit();
    return true;
  }, { date: input.date, time: String(input.time), stylistId: String(input.stylistId) }).catch(() => false);

  if (!submitted) {
    await dumpPageDiag(page, "schedule-no-form");
    throw new WorkerError("external_site_changed", "schedule page missing #extReserve form");
  }

  await page.waitForLoadState("domcontentloaded");
  try {
    await formMarker.waitFor({ state: "attached", timeout: 20000 });
  } catch {
    const title = await page.title().catch(() => "");
    await dumpPageDiag(page, "post-schedule-submit");
    if (/SALON BOARD\s*:\s*TOP/i.test(title)) {
      throw new WorkerError("external_site_changed", `still on TOP after navigation (title=${title})`);
    }
    throw new WorkerError("external_site_changed", `reservation form not loaded (title=${title})`);
  }
}

export async function createReservation(page: Page, input: CreateReservationInput) {
  await gotoReservationForm(page, input);

  // payload 型ログ（Playwright selectOption は string のみ受け付けるため）
  logger.info({
    stylistId: input.stylistId, stylistIdType: typeof input.stylistId,
    setmenuId: input.setmenuId, setmenuIdType: typeof input.setmenuId,
    rsvTerm: input.rsvTerm, rsvTermType: typeof input.rsvTerm,
    rsvRouteId: input.rsvRouteId, rsvRouteIdType: typeof input.rsvRouteId,
    time: input.time, timeType: typeof input.time,
    date: input.date,
  }, "createReservation payload types");

  const toStr = (v: unknown): string => String(v);
  const toStrArr = (v: unknown): string[] => Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];

  // 必須項目入力
  if (input.stylistId != null && await page.locator('select[name="stylistId"]').count()) {
    await page.locator('select[name="stylistId"]').selectOption({ value: toStr(input.stylistId) });
  }
  if (input.time != null && await page.locator('select[name="time"]').count()) {
    await page.locator('select[name="time"]').selectOption({ value: toStr(input.time) });
  }
  if (input.rsvTerm != null) {
    const rsvTerm = page.locator('#rsvTermId, select[name="rsvTerm"]').first();
    try {
      await rsvTerm.waitFor({ state: "attached", timeout: 30000 });
      await rsvTerm.selectOption(toStr(input.rsvTerm));
    } catch (e) {
      await dumpPageDiag(page, "rsvTerm-not-found");
      throw e;
    }
  }

  if (input.rsvRouteId && await page.locator('select[name="rsvRouteId"]').count()) {
    await page.locator('select[name="rsvRouteId"]').selectOption({ value: toStr(input.rsvRouteId) });
  }
  if (input.setmenuId && await page.locator('select[name="setmenuId"]').count()) {
    await page.locator('select[name="setmenuId"]').selectOption({ value: toStr(input.setmenuId) });
  }
  if (input.menuCategoryCdList && await page.locator('select[name="menuCategoryCdList"]').count()) {
    await page.locator('select[name="menuCategoryCdList"]').selectOption(toStrArr(input.menuCategoryCdList));
  }
  if (input.menuIdList && await page.locator('select[name="menuIdList"]').count()) {
    await page.locator('select[name="menuIdList"]').selectOption(toStrArr(input.menuIdList));
  }
  if (input.netCouponId && await page.locator('select[name="netCouponId"]').count()) {
    await page.locator('select[name="netCouponId"]').selectOption({ value: toStr(input.netCouponId) });
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
  logger.info({ finalUrl, snippet: finalText.slice(0, 400) }, "create finalize");

  const detected = detectErrorFromPage({ url: finalUrl, bodyText: finalText });
  if (detected) throw new WorkerError(detected, `create failed: ${detected}`);

  // 入力画面に残っているバリデーションエラー（営業時間外など）を検出
  if (/営業終了時間|終了時間は営業終了時間|入力してください|エラー|必須/.test(finalText) && /extReserveRegist(Input)?\/?$/.test(finalUrl)) {
    const errLine = (finalText.match(/[^\n]*(エラー|してください|営業終了時間)[^\n]*/) || [""])[0].slice(0, 200);
    logger.warn({ finalUrl, errLine }, "validation error on input page");
    throw new WorkerError("external_site_changed", `validation error: ${errLine}`);
  }

  // 完了画面URL・予約番号(BE...)・明確な完了文言のいずれかが必須
  const isCompleteUrl = /extReserveRegistComp|extReserveComp|Complete|complete/.test(finalUrl);
  const m = finalText.match(/(BE\d{6,})/);
  const hasCompleteText = /予約を登録しました|予約が完了|登録が完了|登録を完了/.test(finalText);

  if (!isCompleteUrl && !m && !hasCompleteText) {
    logger.warn({ finalUrl, snippet: finalText.slice(0, 300) }, "create result unclear");
    throw new WorkerError("external_site_changed", "create completion not confirmed");
  }

  return { external_reservation_id: m?.[1] ?? null };
}

async function assertNotLoggedOut(page: Page) {
  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login");
  }
}
