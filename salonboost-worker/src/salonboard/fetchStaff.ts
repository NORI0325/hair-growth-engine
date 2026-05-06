import type { Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

export interface FetchedStaff {
  stylist_id: string;
  display_name: string;
  active: boolean;
  is_no_designation: boolean;
}

/**
 * 予約登録フォームの stylistId セレクトからスタッフ一覧を取得する。
 * これがサロンボード側の正規スタイリスト一覧の最も安定したソース。
 * 「指名なし」相当の選択肢（value=0000000000 や ラベルに『指名なし』）を含む。
 */
export async function fetchSalonboardStaff(page: Page): Promise<FetchedStaff[]> {
  // 今日の任意時刻で予約フォームを開く
  const today = new Date();
  const j = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const date = `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, "0")}${String(j.getUTCDate()).padStart(2, "0")}`;
  const url = `https://salonboard.com/CLP/bt/reserve/ext/extReserveRegistInput/?date=${date}&time=1000&stylistId=0000000000`;

  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login (fetchStaff)");
  }

  const select = page.locator('select[name="stylistId"]');
  if (!(await select.count())) {
    throw new WorkerError("external_site_changed", "stylistId select not found");
  }

  const options = await select.locator("option").evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      label: ((el as HTMLOptionElement).textContent || "").trim(),
      disabled: (el as HTMLOptionElement).disabled,
    }))
  );

  const result: FetchedStaff[] = [];
  for (const o of options) {
    if (!o.value) continue;
    const isNoDesignation = o.value === "0000000000" || /指名なし|指名無し|フリー/.test(o.label);
    result.push({
      stylist_id: o.value,
      display_name: o.label || (isNoDesignation ? "指名なし" : o.value),
      active: !o.disabled,
      is_no_designation: isNoDesignation,
    });
  }
  logger.info({ count: result.length }, "fetched salonboard staff");
  return result;
}
