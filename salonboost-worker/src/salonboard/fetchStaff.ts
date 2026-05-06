import type { Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

export interface FetchedStaff {
  stylist_id: string;
  display_name: string;
  active: boolean;
  is_no_designation: boolean;
}

function cleanLabel(s: string): string {
  return (s || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\u25CB\u25CF\u30FB\u26AB\u26AA\u2605\u2606\*\-\u30FB\s]+/, "")
    .trim();
}

async function snapshot(page: Page) {
  const url = page.url();
  let title = "";
  let body = "";
  let selects: string[] = [];
  try { title = await page.title(); } catch {}
  try { body = (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 500); } catch {}
  try {
    selects = await page.locator("select").evaluateAll((els) =>
      els.map((el) => `name=${(el as HTMLSelectElement).name} id=${(el as HTMLSelectElement).id}`)
    );
  } catch {}
  return { url, title, body, selects };
}

/**
 * 予約新規登録画面の stylistId セレクトからスタッフ一覧を取得する。
 */
export async function fetchSalonboardStaff(page: Page): Promise<FetchedStaff[]> {
  const today = new Date();
  const j = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const date = `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, "0")}${String(j.getUTCDate()).padStart(2, "0")}`;
  const url = `https://salonboard.com/CLP/bt/reserve/ext/extReserveRegist/?date=${date}&time=1000&stylistId=0000000000`;

  logger.info({ url }, "navigating to reserve regist page (fetchStaff)");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  } catch (e) {
    logger.warn({ e: (e as Error).message }, "goto timeout but continuing (fetchStaff)");
  }

  if (/\/login/i.test(page.url()) && !/doLogin/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login (fetchStaff)");
  }

  // wait for select to be present
  try {
    await page.waitForSelector('select[name="stylistId"]', { timeout: 30000 });
  } catch {
    const snap = await snapshot(page);
    logger.error(snap, "stylistId select not found");
    throw new WorkerError(
      "external_site_changed",
      `stylistId select not found url=${snap.url} title=${snap.title} selects=${JSON.stringify(snap.selects)} body=${snap.body}`
    );
  }

  const select = page.locator('select[name="stylistId"]').first();
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
    const label = cleanLabel(o.label);
    const isNoDesignation =
      o.value === "0000000000" || /指名なし|指名無し|フリー/.test(label);
    result.push({
      stylist_id: o.value,
      display_name: label || (isNoDesignation ? "指名なし" : o.value),
      active: !o.disabled,
      is_no_designation: isNoDesignation,
    });
  }
  logger.info({ count: result.length, items: result }, "fetched salonboard staff");
  return result;
}
