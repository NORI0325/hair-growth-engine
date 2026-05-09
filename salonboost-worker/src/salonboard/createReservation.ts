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

async function getCreateFormDiag(page: Page, input: CreateReservationInput, label: string) {
  const desired = {
    time: String(input.time ?? ""),
    rsvTerm: String(input.rsvTerm ?? ""),
    setmenuId: String(input.setmenuId ?? ""),
    stylistId: String(input.stylistId ?? ""),
  };
  const form = await page.evaluate((desiredValues) => {
    const readSelect = (selector: string, desiredValue: string) => {
      const el = document.querySelector(selector) as HTMLSelectElement | null;
      if (!el) return { exists: false, value: null, selectedText: null, desiredOptionExists: false, desiredOptionText: null };
      const opts = Array.from(el.options).map((o) => ({ value: o.value, text: (o.textContent || "").trim() }));
      const selected = el.selectedOptions?.[0];
      const desiredOpt = opts.find((o) => o.value === desiredValue) || null;
      return {
        exists: true,
        value: el.value,
        selectedText: (selected?.textContent || "").trim() || null,
        desiredOptionExists: !!desiredOpt,
        desiredOptionText: desiredOpt?.text || null,
      };
    };
    const readInput = (selector: string) => {
      const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      return el?.value ?? null;
    };
    return {
      url: location.href,
      title: document.title,
      date: readInput('input[name="date"]') || desiredValues.date,
      time: readSelect('select[name="time"]', desiredValues.time),
      rsvTerm: readSelect('#rsvTermId, select[name="rsvTerm"]', desiredValues.rsvTerm),
      setmenuId: readSelect('select[name="setmenuId"]', desiredValues.setmenuId),
      stylistId: readSelect('select[name="stylistId"]', desiredValues.stylistId),
      rsvRouteId: readSelect('select[name="rsvRouteId"]', desiredValues.rsvRouteId),
      nmSei: readInput('input[name="nmSei"]'),
      nmMei: readInput('input[name="nmMei"]'),
      tel: readInput('input[name="tel"]'),
    };
  }, { ...desired, date: input.date, rsvRouteId: String(input.rsvRouteId ?? "") }).catch((e) => ({
    error: e instanceof Error ? e.message : String(e),
  }));

  const actualTime = (form as any)?.time?.value ?? desired.time;
  const actualRsvTerm = (form as any)?.rsvTerm?.value ?? desired.rsvTerm;
  const hhmm = String(actualTime || "").padStart(4, "0");
  const minutes = Number(actualRsvTerm);
  let calculatedEndTime: string | null = null;
  if (/^\d{4}$/.test(hhmm) && Number.isFinite(minutes)) {
    const start = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
    const end = start + minutes;
    calculatedEndTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  }

  return {
    label,
    selected_time: actualTime,
    selected_rsvTerm: actualRsvTerm,
    selected_setmenuId: (form as any)?.setmenuId?.value ?? null,
    selected_stylistId: (form as any)?.stylistId?.value ?? null,
    rsvTime_option_exists: (form as any)?.time?.desiredOptionExists ?? false,
    rsvTerm_option_exists: (form as any)?.rsvTerm?.desiredOptionExists ?? false,
    setmenuId_option_exists: (form as any)?.setmenuId?.desiredOptionExists ?? false,
    stylistId_option_exists: (form as any)?.stylistId?.desiredOptionExists ?? false,
    selectedMenuText: (form as any)?.setmenuId?.selectedText ?? null,
    selectedStaffText: (form as any)?.stylistId?.selectedText ?? null,
    calculatedEndTime,
    form,
  };
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
  logger.info(await getCreateFormDiag(page, input, "initial form values"), "salonboard create form diag");
  if (input.stylistId != null && await page.locator('select[name="stylistId"]').count()) {
    await page.locator('select[name="stylistId"]').selectOption({ value: toStr(input.stylistId) });
  }
  if (input.time != null && await page.locator('select[name="time"]').count()) {
    await page.locator('select[name="time"]').selectOption({ value: toStr(input.time) });
  }
  logger.info(await getCreateFormDiag(page, input, "after staff/time selection"), "salonboard create form diag");
  if (input.rsvTerm != null) {
    const rsvTerm = page.locator('#rsvTermId, select[name="rsvTerm"]').first();
    try {
      await rsvTerm.waitFor({ state: "attached", timeout: 30000 });
      await rsvTerm.selectOption(toStr(input.rsvTerm));
      logger.info(await getCreateFormDiag(page, input, "after rsvTerm selection before menu"), "salonboard create form diag");
    } catch (e) {
      await dumpPageDiag(page, "rsvTerm-not-found");
      logger.warn(await getCreateFormDiag(page, input, "rsvTerm selection failed"), "salonboard create form diag");
      throw e;
    }
  }

  if (input.rsvRouteId && await page.locator('select[name="rsvRouteId"]').count()) {
    await page.locator('select[name="rsvRouteId"]').selectOption({ value: toStr(input.rsvRouteId) });
  }
  if (input.setmenuId && await page.locator('select[name="setmenuId"]').count()) {
    await page.locator('select[name="setmenuId"]').selectOption({ value: toStr(input.setmenuId) });
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    logger.info(await getCreateFormDiag(page, input, "after setmenuId selection"), "salonboard create form diag");
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

  const preSubmitDiag = await getCreateFormDiag(page, input, "before submit");
  logger.info(preSubmitDiag, "salonboard create submit form values");

  // 登録ボタン押下前に確認ダイアログ (window.confirm) ハンドラを設定
  let dialogDuplicate = false;
  let dialogUnexpected: string | null = null;
  let lastDialogMessage: string | null = null;
  const dialogHandler = async (dialog: import("playwright").Dialog) => {
    const message = dialog.message();
    lastDialogMessage = message;
    logger.info({ message, type: dialog.type() }, "salonboard confirm dialog");
    // 通常の登録確認 → OK
    if (/予約を登録します|登録します。よろしい|よろしいですか/.test(message)
        && !/重複|同一|既に予約|予約が存在|同じ時間/.test(message)) {
      await dialog.accept().catch(() => {});
      return;
    }
    // 明確な重複系
    if (/重複|同一の予約|既に予約|予約が存在|同じ時間/.test(message)) {
      dialogDuplicate = true;
      await dialog.dismiss().catch(() => {});
      return;
    }
    // 不明 → 安全側で閉じる
    dialogUnexpected = message;
    await dialog.dismiss().catch(() => {});
  };
  page.on("dialog", dialogHandler);

  try {
    // 登録ボタン押下（dialog → 遷移の順に発生する想定）
    await page.locator('a#regist').click().catch((e) => {
      logger.warn({ e: e instanceof Error ? e.message : String(e) }, "regist click failed");
    });
    // dialog 処理 + 遷移待ち
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});

    if (dialogDuplicate) {
      await dumpPageDiag(page, "duplicate-dialog");
      throw new WorkerError("duplicate_risk", `duplicate dialog: ${lastDialogMessage ?? ""}`);
    }
    if (dialogUnexpected) {
      await dumpPageDiag(page, "unexpected-dialog");
      throw new WorkerError("external_site_changed", `unexpected dialog: ${dialogUnexpected}`);
    }

    // 確認画面が別ページで出る場合 → 「登録する」を押す
    const confirmBtn = page.locator('a#regist, a.mod_btn_entry_08').first();
    const bodyTextNow = await page.locator("body").innerText().catch(() => "");
    if (await confirmBtn.count() && /\/extReserveRegistConfirm|確認/.test(page.url() + bodyTextNow)) {
      await Promise.all([
        page.waitForLoadState("domcontentloaded").catch(() => {}),
        confirmBtn.click().catch(() => {}),
      ]);
    }
  } finally {
    page.off("dialog", dialogHandler);
  }

  // 完了判定
  const finalUrl = page.url();
  const finalText = await page.locator("body").innerText().catch(() => "");
  logger.info({ finalUrl, snippet: finalText.slice(0, 400) }, "create finalize");

  const detected = detectErrorFromPage({ url: finalUrl, bodyText: finalText });
  if (detected) throw new WorkerError(detected, `create failed: ${detected}`);

  // サロンボード側の入力バリデーションエラー検知（doComplete 含むあらゆるURLで先に判定）
  const invalidCharMatch = finalText.match(/[^\n]*(不正な文字|使用できない文字列|登録できません|必須|入力してください|エラー)[^\n]*/);
  if (invalidCharMatch) {
    const errLine = invalidCharMatch[0].slice(0, 300);
    // 完了文言が同時にあるなら本物の完了優先（誤検知回避）
    const trulyCompleted = /予約を登録しました|予約が完了|登録が完了|登録を完了/.test(finalText)
      && !/不正な文字|使用できない文字列/.test(finalText);
    if (!trulyCompleted) {
      logger.warn({
        finalUrl,
        errLine,
        page_body_error_snippet: finalText.slice(0, 800),
        submit_values: await getCreateFormDiag(page, input, "validation error after submit"),
      }, "salonboard input validation error");
      const isNameError = /不正な文字|使用できない文字列|氏名|カナ/.test(errLine);
      const msg = isNameError
        ? "[salonboard] 入力エラー: 氏名またはカナにサロンボードで使用できない文字が含まれています。数字入りのテスト名は使わず、カナはカタカナで入力してください。"
        : `[salonboard] 入力エラー: ${errLine}`;
      throw new WorkerError("external_site_changed", msg);
    }
  }

  // 完了画面URL or 予約番号(BE...) or 完了文言が必要（doComplete URL だけでは成功扱いしない）
  const isCompleteUrl = /extReserveRegistComp|extReserveComp|Complete|complete|doComplete|salonSchedule/.test(finalUrl);
  const hasCompleteText = /予約を登録しました|予約が完了|登録が完了|登録を完了/.test(finalText);

  // 予約ID 抽出: 本文 BE\d+ / 各種URLパラメータ / hidden input / リンク
  let reserveId: string | null = null;
  const mText = finalText.match(/(BE\d{6,})/);
  if (mText) reserveId = mText[1];
  if (!reserveId) {
    const mUrl = finalUrl.match(/(?:rsvId|reserveId|reserve_id|rsvid|reservationId)=([A-Za-z0-9]+)/i);
    if (mUrl) reserveId = mUrl[1];
  }
  if (!reserveId) {
    try {
      const idFromDom = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('a[href], [onclick]')) as HTMLElement[];
        for (const el of all) {
          const href = el.getAttribute("href") || "";
          const onclick = el.getAttribute("onclick") || "";
          const m = (href + " " + onclick).match(/(?:rsvId|reserveId|reserve_id|reservationId)['"=:\s]+([A-Z0-9]+)/i);
          if (m) return m[1];
        }
        const inp = document.querySelector('input[name="rsvId"], input[name="reserveId"], input[name="reservationId"]') as HTMLInputElement | null;
        if (inp?.value) return inp.value;
        const txt = document.body?.innerText || "";
        const m2 = txt.match(/予約番号[^\w]*([A-Z0-9]{6,})/);
        if (m2) return m2[1];
        return null;
      });
      if (idFromDom) reserveId = idFromDom;
    } catch {}
  }

  logger.info({ finalUrl, isCompleteUrl, hasCompleteText, reserveId, snippet: finalText.slice(0, 500) }, "create result diag");

  // 「予約を登録しました。」が出ていれば登録成功と確定（reserveIdは後から復元する）
  const createdSuccessfully = hasCompleteText || !!reserveId;
  if (!createdSuccessfully) {
    logger.warn({ finalUrl, isCompleteUrl }, "create result: no reserveId & no complete text");
    throw new WorkerError("external_site_changed", "create completion not confirmed (no reserveId / no complete message)");
  }

  // フォールバック: 予約IDが取れなかった場合、スケジュール画面から検索して取得
  if (!reserveId) {
    try {
      logger.info({ date: input.date, time: input.time }, "createReservation: fallback findReservation for reserveId");
      const { findReservations } = await import("./findReservation.js");
      const items = await findReservations(page, {
        date: input.date,
        time: input.time,
        customerName: `${input.nmSei}${input.nmMei}`,
        stylistId: input.stylistId,
      });
      const hit = items.find((i) => i.external_reservation_id);
      if (hit?.external_reservation_id) {
        reserveId = hit.external_reservation_id;
        logger.info({ reserveId }, "createReservation: reserveId resolved via fallback find");
      } else {
        logger.warn({ count: items.length }, "createReservation: fallback find returned no reserveId (will return success without id)");
      }
    } catch (e) {
      logger.warn({ e: e instanceof Error ? e.message : String(e) }, "createReservation: fallback find failed");
    }
  }

  return { external_reservation_id: reserveId };
}

async function assertNotLoggedOut(page: Page) {
  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login");
  }
}
