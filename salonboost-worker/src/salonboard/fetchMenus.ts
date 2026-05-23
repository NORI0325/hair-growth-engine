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
  source_type: "setmenu" | "single_menu" | "category" | "coupon";
  raw_payload?: Record<string, unknown>;
}

function normalizeNumericText(value: unknown): string {
  return String(value ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPrice(label: string): number | null {
  const text = normalizeNumericText(label);
  const patterns = [
    /(?:→|->)\s*(?:[¥￥])?\s*([0-9][0-9,]*)/,
    /[¥￥]\s*([0-9][0-9,]*)/,
    /([0-9][0-9,]*)\s*円/,
    /(?:税込|税抜|価格|料金)\D*([0-9][0-9,]*)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const price = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(price) && price > 0) return price;
  }
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

function parseNumberLike(v: unknown): number | null {
  const raw = normalizeNumericText(v).replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const m = raw.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function pickFirst(fields: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

type SetmenuCandidate = {
  setmenu_id: string;
  menu_name: string | null;
  rsv_term: number | null;
  price: number | null;
  raw_payload: Record<string, string>;
};

function readFieldByPattern(fields: Record<string, string>, pattern: RegExp): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (pattern.test(key) && String(value).trim()) return String(value).trim();
  }
  return null;
}

function isTruthyFlag(value: string | null): boolean {
  return /^(1|true|on|yes|y)$/i.test(String(value ?? "").trim());
}

function isFalsyFlag(value: string | null): boolean {
  return /^(0|false|off|no|n)$/i.test(String(value ?? "").trim());
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

async function extractSingleMenuCandidates(page: Page): Promise<{
  menus: FetchedMenu[];
  total_candidates: number;
  skipped_without_id: number;
  sample_without_id: Array<Record<string, string>>;
}> {
  const rows = await page.evaluate(() => {
    const groups: Record<string, Record<string, string>> = {};
    const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input[name^="frmMenuListDtoList["], select[name^="frmMenuListDtoList["], textarea[name^="frmMenuListDtoList["]',
    ));

    for (const el of controls) {
      const match = el.name.match(/^frmMenuListDtoList\[(\d+)\]\.([A-Za-z0-9_.-]+)$/);
      if (!match) continue;
      const [, index, field] = match;
      groups[index] ||= {};
      if (el instanceof HTMLSelectElement) {
        groups[index][field] = el.value || "";
        const selected = el.selectedOptions?.[0]?.textContent?.replace(/\s+/g, " ").trim();
        if (selected) groups[index][`${field}_label`] = selected;
      } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        groups[index][field] = el.checked ? (el.value || "true") : "";
      } else {
        groups[index][field] = el.value || "";
      }
    }

    return Object.entries(groups).map(([index, fields]) => ({ index, fields }));
  }).catch(() => [] as Array<{ index: string; fields: Record<string, string> }>);

  const menus: FetchedMenu[] = [];
  const withoutId: Array<Record<string, string>> = [];

  for (const row of rows) {
    const fields = row.fields || {};
    const name = pickFirst(fields, ["menuName", "name", "menuNm", "dispMenuName"]);
    if (!name) continue;

    const stableId = pickFirst(fields, [
      "menuId",
      "menuID",
      "menu_id",
      "id",
      "menuCd",
      "menuCode",
      "menuNo",
      "menuSeq",
      "menuSerialNo",
    ]);
    if (!stableId) {
      withoutId.push(fields);
      continue;
    }

    const categoryCd = pickFirst(fields, [
      "menuCategoryCd",
      "menuCategoryCode",
      "menuCategory",
      "menuCategoryCdList",
      "categoryCd",
    ]);
    const price = parseNumberLike(pickFirst(fields, ["price", "menuPrice", "sales", "taxIncludedPrice", "priceTaxIn"]));
    const term = parseNumberLike(pickFirst(fields, [
      "sejyutsuAimTimeCd",
      "sejyutsuAimTime",
      "rsvTerm",
      "term",
      "duration",
      "aimTime",
      "workTime",
    ]));
    const deleteFlag = pickFirst(fields, ["deleteFlg", "deletedFlg", "delFlg", "deleteFlag", "delFlag"]);
    const presentFlag = pickFirst(fields, ["presentFlg", "presentFlag", "hpPresentFlg", "hotpepperPresentFlg"]);
    const active = !isTruthyFlag(deleteFlag) && !isFalsyFlag(presentFlag);

    menus.push({
      external_menu_id: stableId,
      setmenu_id: null,
      menu_id: stableId,
      menu_category_cd: categoryCd,
      net_coupon_id: null,
      menu_name: name,
      rsv_term: term,
      price,
      active,
      source_type: "single_menu",
      raw_payload: { index: row.index, fields },
    });
  }

  return {
    menus,
    total_candidates: rows.length,
    skipped_without_id: withoutId.length,
    sample_without_id: withoutId.slice(0, 3),
  };
}

async function extractSetmenuCandidates(page: Page): Promise<Map<string, SetmenuCandidate>> {
  const rows = await page.evaluate(() => {
    const groups: Record<string, Record<string, string>> = {};
    const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    ));

    for (const el of controls) {
      const name = el.name || el.id || "";
      if (!/set.?menu|setMenu|SetMenu|set_menu|setM/i.test(name)) continue;
      const match = name.match(/^(.+\[\d+\])\.?([A-Za-z0-9_.-]+)$/);
      if (!match) continue;
      const [, groupKey, field] = match;
      groups[groupKey] ||= {};
      if (el instanceof HTMLSelectElement) {
        groups[groupKey][field] = el.value || "";
        const selected = el.selectedOptions?.[0]?.textContent?.replace(/\s+/g, " ").trim();
        if (selected) groups[groupKey][`${field}_label`] = selected;
      } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        groups[groupKey][field] = el.checked ? (el.value || "true") : "";
      } else {
        groups[groupKey][field] = el.value || "";
      }
    }

    return Object.values(groups);
  }).catch(() => [] as Array<Record<string, string>>);

  const byId = new Map<string, SetmenuCandidate>();
  for (const fields of rows) {
    const setmenuId = pickFirst(fields, [
      "setmenuId",
      "setMenuId",
      "setmenuID",
      "setmenu_id",
      "setMenuCd",
      "setmenuCd",
      "setMenuNo",
      "setmenuNo",
      "id",
    ]) || readFieldByPattern(fields, /set.?menu.*(id|cd|no)$/i);
    if (!setmenuId || !/^SN/i.test(setmenuId)) continue;

    const menuName = pickFirst(fields, [
      "setmenuName",
      "setMenuName",
      "setmenuNm",
      "setMenuNm",
      "menuName",
      "name",
    ]) || readFieldByPattern(fields, /(set.?menu|menu).*(name|nm)$/i);
    const priceText = pickFirst(fields, [
      "price",
      "setmenuPrice",
      "setMenuPrice",
      "sales",
      "taxIncludedPrice",
      "priceTaxIn",
      "charge",
      "amount",
      "fee",
    ]) || readFieldByPattern(fields, /(price|charge|amount|fee|sales|kingaku|kakaku|ryokin)$/i);
    const termText = pickFirst(fields, [
      "rsvTerm",
      "term",
      "duration",
      "sejyutsuAimTimeCd",
      "sejyutsuAimTime",
      "workTime",
    ]) || readFieldByPattern(fields, /(rsvTerm|term|duration|aimTime|workTime)$/i);
    const price = extractPrice(priceText || "") ?? parseNumberLike(priceText);
    const rsvTerm = parseNumberLike(termText);

    byId.set(setmenuId, {
      setmenu_id: setmenuId,
      menu_name: menuName,
      rsv_term: rsvTerm,
      price,
      raw_payload: fields,
    });
  }
  return byId;
}

async function readSelectedSetmenuPrice(page: Page, selectedLabel: string): Promise<number | null> {
  const optionPrice = extractPrice(selectedLabel);
  if (optionPrice) return optionPrice;

  const candidates = await page.evaluate(() => {
    const values: string[] = [];
    const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    ));
    const priceLike = /(price|charge|amount|fee|sales|kingaku|kakaku|ryokin)/i;

    for (const el of controls) {
      const key = `${el.name || ""} ${el.id || ""}`;
      if (!priceLike.test(key)) continue;
      if (el instanceof HTMLSelectElement) {
        if (el.value) values.push(el.value);
        const selected = el.selectedOptions?.[0]?.textContent?.replace(/\s+/g, " ").trim();
        if (selected) values.push(selected);
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.value) values.push(el.value);
      }
    }
    return values;
  }).catch(() => [] as string[]);

  for (const candidate of candidates) {
    const price = extractPrice(candidate) ?? parseNumberLike(candidate);
    if (price) return price;
  }
  return null;
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
  const singleMenuDiag = await extractSingleMenuCandidates(page);
  const setmenuCandidateById = await extractSetmenuCandidates(page);

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
    const setmenuCandidate = setmenuCandidateById.get(o.value);
    let rsvTerm: number | null = setmenuCandidate?.rsv_term ?? null;
    let price: number | null = extractPrice(o.label) ?? setmenuCandidate?.price ?? null;
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
        rsvTerm = last ?? rsvTerm;
        if (rsvTerm === null) {
          const diag = await diagnoseRsvTerm(page);
          logger.warn({ setmenuId: o.value, diag }, "rsvTerm not detected for setmenu");
        }
        price = price ?? await readSelectedSetmenuPrice(page, o.label);
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
      menu_name: setmenuCandidate?.menu_name || o.label || o.value,
      rsv_term: rsvTerm,
      price,
      active: !o.disabled,
      source_type: "setmenu",
      raw_payload: { option_label: o.label, setmenu_candidate: setmenuCandidate?.raw_payload ?? null },
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

  result.push(...singleMenuDiag.menus);

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
      setmenu_with_price: result.filter((r) => r.source_type === "setmenu" && r.price !== null).length,
      single_menu_candidates: singleMenuDiag.total_candidates,
      single_menu: singleMenuDiag.menus.length,
      single_menu_skipped_without_id: singleMenuDiag.skipped_without_id,
      single_menu_sample_without_id: singleMenuDiag.sample_without_id,
      category: categoryOpts.length,
      coupon: couponOpts.length,
    },
    "fetched salonboard menus"
  );
  return result;
}
