import type { Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

export interface FetchedMenu {
  external_menu_id: string;
  setmenu_id: string | null;
  menu_id: string | null;
  menu_category_cd: string | null;
  net_coupon_id: string | null;
  menu_name: string;
  rsv_term: number | null;
  price: number | null;
  active: boolean;
  source_type: "setmenu" | "category" | "coupon";
}

function extractPrice(label: string): number | null {
  // 「→¥11000」「¥13200→¥11000」のように矢印後の値を優先
  const arrow = label.match(/(?:→|->)\s*[¥￥]?\s*([0-9,]+)/);
  if (arrow) return Number(arrow[1].replace(/,/g, ""));
  const m = label.match(/[¥￥]\s*([0-9,]+)/);
  if (m) return Number(m[1].replace(/,/g, ""));
  return null;
}

async function snapshot(page: Page) {
  const url = page.url();
  let title = "";
  let body = "";
  let selects: Array<{ name: string; id: string; option_count: number }> = [];
  try { title = await page.title(); } catch {}
  try { body = (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 1000); } catch {}
  try {
    selects = await page.locator("select").evaluateAll((els) =>
      els.map((el) => {
        const s = el as HTMLSelectElement;
        return { name: s.name, id: s.id, option_count: s.options.length };
      })
    );
  } catch {}
  return { url, title, body, selects };
}

async function extractOptions(page: Page, selector: string) {
  const exists = await page.locator(selector).count();
  if (exists === 0) return [] as Array<{ value: string; label: string; disabled: boolean }>;
  return await page.locator(`${selector} option`).evaluateAll((els) =>
    els.map((el) => {
      const o = el as HTMLOptionElement;
      return {
        value: o.value,
        label: (o.textContent || "").replace(/\s+/g, " ").trim(),
        disabled: o.disabled,
      };
    })
  );
}

export async function fetchSalonboardMenus(page: Page): Promise<FetchedMenu[]> {
  const today = new Date();
  const j = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const date = `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, "0")}${String(j.getUTCDate()).padStart(2, "0")}`;
  const url = `https://salonboard.com/CLP/bt/reserve/ext/extReserveRegist/?date=${date}&time=1000&stylistId=0000000000`;

  logger.info({ url }, "navigating to reserve regist page (fetchMenus)");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  } catch (e) {
    logger.warn({ e: (e as Error).message }, "goto timeout but continuing (fetchMenus)");
  }

  if (/\/login/i.test(page.url()) && !/doLogin/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login (fetchMenus)");
  }

  // 何かしらの select が現れるのを待つ（最低限 setmenuId or menuCategoryCdList or netCouponId）
  try {
    await page.waitForSelector(
      'select[name="setmenuId"], select[name="menuCategoryCdList"], select[name="netCouponId"]',
      { timeout: 30000 }
    );
  } catch {
    // 後段の診断に任せる
  }

  const [setmenuOpts, categoryOpts, couponOpts] = await Promise.all([
    extractOptions(page, 'select[name="setmenuId"]'),
    extractOptions(page, 'select[name="menuCategoryCdList"]'),
    extractOptions(page, 'select[name="netCouponId"]'),
  ]);

  const result: FetchedMenu[] = [];

  for (const o of setmenuOpts) {
    if (!o.value) continue;
    result.push({
      external_menu_id: o.value,
      setmenu_id: o.value,
      menu_id: null,
      menu_category_cd: null,
      net_coupon_id: null,
      menu_name: o.label || o.value,
      rsv_term: null,
      price: extractPrice(o.label),
      active: !o.disabled,
      source_type: "setmenu",
    });
  }

  for (const o of categoryOpts) {
    if (!o.value) continue;
    result.push({
      external_menu_id: o.value,
      setmenu_id: null,
      menu_id: null,
      menu_category_cd: o.value,
      net_coupon_id: null,
      menu_name: o.label || o.value,
      rsv_term: null,
      price: null,
      active: !o.disabled,
      source_type: "category",
    });
  }

  for (const o of couponOpts) {
    if (!o.value) continue;
    result.push({
      external_menu_id: o.value,
      setmenu_id: null,
      menu_id: null,
      menu_category_cd: null,
      net_coupon_id: o.value,
      menu_name: o.label || o.value,
      rsv_term: null,
      price: extractPrice(o.label),
      active: !o.disabled,
      source_type: "coupon",
    });
  }

  if (result.length === 0) {
    const snap = await snapshot(page);
    logger.error(snap, "no menu options found");
    throw new WorkerError(
      "external_site_changed",
      `no menu options found url=${snap.url} title=${snap.title} selects=${JSON.stringify(snap.selects)} body=${snap.body}`
    );
  }

  logger.info(
    {
      count: result.length,
      setmenu: setmenuOpts.length,
      category: categoryOpts.length,
      coupon: couponOpts.length,
    },
    "fetched salonboard menus"
  );
  return result;
}
