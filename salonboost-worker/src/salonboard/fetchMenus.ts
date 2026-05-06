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
  const arrow = label.match(/(?:→|->)\s*[¥￥]?\s*([0-9,]+)/);
  if (arrow) return Number(arrow[1].replace(/,/g, ""));
  const m = label.match(/[¥￥]\s*([0-9,]+)/);
  if (m) return Number(m[1].replace(/,/g, ""));
  return null;
}

// "1:30" → 90, "0:30" → 30, "90分" → 90
function parseTermLabel(s: string): number | null {
  const t = (s || "").trim();
  const colon = t.match(/^(\d+):(\d{2})/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const min = t.match(/(\d+)\s*分/);
  if (min) return Number(min[1]);
  const num = t.match(/^\d+$/);
  if (num) return Number(t);
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

async function readRsvTerm(page: Page): Promise<number | null> {
  // 1. select[name="rsvTerm"]
  for (const sel of ['select[name="rsvTerm"]', 'select#rsvTermId']) {
    const loc = page.locator(sel);
    if (await loc.count()) {
      try {
        const v = await loc.inputValue();
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
      } catch {}
      // fallback: selected option text
      try {
        const txt = await loc.locator("option:checked").first().textContent();
        const parsed = parseTermLabel(txt || "");
        if (parsed) return parsed;
      } catch {}
    }
  }
  return null;
}

async function diagnoseRsvTerm(page: Page) {
  const sel = page.locator('select[name="rsvTerm"], select#rsvTermId').first();
  const exists = (await sel.count()) > 0;
  let current: string | null = null;
  let options: Array<{ value: string; label: string }> = [];
  if (exists) {
    try { current = await sel.inputValue(); } catch {}
    try {
      options = await sel.locator("option").evaluateAll((els) =>
        els.map((el) => {
          const o = el as HTMLOptionElement;
          return { value: o.value, label: (o.textContent || "").trim() };
        })
      );
    } catch {}
  }
  return { exists, current, options };
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

  try {
    await page.waitForSelector(
      'select[name="setmenuId"], select[name="menuCategoryCdList"], select[name="netCouponId"]',
      { timeout: 30000 }
    );
  } catch {}

  const [setmenuOpts, categoryOpts, couponOpts] = await Promise.all([
    extractOptions(page, 'select[name="setmenuId"]'),
    extractOptions(page, 'select[name="menuCategoryCdList"]'),
    extractOptions(page, 'select[name="netCouponId"]'),
  ]);

  const result: FetchedMenu[] = [];

  // setmenu: 1件ずつ選択して rsvTerm を取得
  const setmenuSel = page.locator('select[name="setmenuId"]');
  const hasSetmenu = (await setmenuSel.count()) > 0;
  let baselineTerm: number | null = null;
  if (hasSetmenu) {
    try { await setmenuSel.selectOption(""); } catch {}
    await page.waitForTimeout(400);
    baselineTerm = await readRsvTerm(page);
  }

  for (const o of setmenuOpts) {
    if (!o.value) continue;
    let rsvTerm: number | null = null;
    if (hasSetmenu) {
      try {
        await setmenuSel.selectOption(o.value);
        // JSが rsvTerm を更新するのを待つ：値が変わるか、最大1500ms
        const start = Date.now();
        let last: number | null = null;
        while (Date.now() - start < 1500) {
          await page.waitForTimeout(150);
          last = await readRsvTerm(page);
          if (last !== null && last !== baselineTerm) break;
        }
        rsvTerm = last;
        if (rsvTerm === null) {
          const diag = await diagnoseRsvTerm(page);
          logger.warn({ setmenuId: o.value, diag }, "rsvTerm not detected for setmenu");
        }
      } catch (e) {
        logger.warn({ setmenuId: o.value, e: (e as Error).message }, "selectOption failed");
      }
    }
    result.push({
      external_menu_id: o.value,
      setmenu_id: o.value,
      menu_id: null,
      menu_category_cd: null,
      net_coupon_id: null,
      menu_name: o.label || o.value,
      rsv_term: rsvTerm,
      price: extractPrice(o.label),
      active: !o.disabled,
      source_type: "setmenu",
    });
  }

  // 選択をリセット
  if (hasSetmenu) { try { await setmenuSel.selectOption(""); } catch {} }

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

  const setmenuWithTerm = result.filter((r) => r.source_type === "setmenu" && r.rsv_term !== null).length;
  logger.info(
    {
      count: result.length,
      setmenu: setmenuOpts.length,
      setmenu_with_term: setmenuWithTerm,
      category: categoryOpts.length,
      coupon: couponOpts.length,
    },
    "fetched salonboard menus"
  );
  return result;
}
