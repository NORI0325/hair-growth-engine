import type { Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

export interface FetchedMenu {
  external_menu_id: string;       // setmenuId 優先、無ければ menuId
  setmenu_id: string | null;
  menu_id: string | null;
  menu_category_cd: string | null;
  menu_name: string;
  rsv_term: number | null;
  price: number | null;
  active: boolean;
}

/**
 * 予約登録フォームから setmenuId / menuIdList のセレクトを抽出してメニュー一覧を得る。
 * data-* 属性に rsvTerm / price / categoryCd が埋まっている場合があるのでそれも吸う。
 */
export async function fetchSalonboardMenus(page: Page): Promise<FetchedMenu[]> {
  const today = new Date();
  const j = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const date = `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, "0")}${String(j.getUTCDate()).padStart(2, "0")}`;
  const url = `https://salonboard.com/CLP/bt/reserve/ext/extReserveRegistInput/?date=${date}&time=1000&stylistId=0000000000`;

  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(page.url())) {
    throw new WorkerError("session_expired", "redirected to login (fetchMenus)");
  }

  // setmenuId 優先
  const setmenuOptions = await page.locator('select[name="setmenuId"] option').evaluateAll((els) =>
    els.map((el) => {
      const o = el as HTMLOptionElement;
      const ds = (o as any).dataset || {};
      const numFromText = (s: string, re: RegExp): number | null => {
        const m = s.match(re); return m ? Number(m[1]) : null;
      };
      const label = (o.textContent || "").trim();
      return {
        value: o.value,
        label,
        disabled: o.disabled,
        rsvTerm: ds.rsvterm ? Number(ds.rsvterm) : numFromText(label, /(\d{2,3})\s*分/),
        price: ds.price ? Number(ds.price) : numFromText(label, /([0-9,]+)\s*円/) ? Number((label.match(/([0-9,]+)\s*円/) || [])[1]?.replace(/,/g, "")) : null,
        categoryCd: ds.categorycd || null,
        menuId: ds.menuid || null,
      };
    })
  );

  const result: FetchedMenu[] = [];

  if (setmenuOptions.length > 0) {
    for (const o of setmenuOptions) {
      if (!o.value) continue;
      result.push({
        external_menu_id: o.value,
        setmenu_id: o.value,
        menu_id: o.menuId,
        menu_category_cd: o.categoryCd,
        menu_name: o.label,
        rsv_term: o.rsvTerm,
        price: o.price,
        active: !o.disabled,
      });
    }
  } else {
    // menuIdList セレクト or チェックボックスへフォールバック
    const menuOptions = await page.locator('select[name="menuIdList"] option, input[name="menuIdList"]').evaluateAll((els) =>
      els.map((el) => {
        const tag = el.tagName;
        if (tag === "OPTION") {
          const o = el as HTMLOptionElement;
          const label = (o.textContent || "").trim();
          const ds = (o as any).dataset || {};
          return {
            value: o.value,
            label,
            disabled: o.disabled,
            rsvTerm: ds.rsvterm ? Number(ds.rsvterm) : null,
            categoryCd: ds.categorycd || null,
          };
        } else {
          const inp = el as HTMLInputElement;
          const label = (inp.parentElement?.textContent || inp.value).trim();
          const ds = (inp as any).dataset || {};
          return {
            value: inp.value,
            label,
            disabled: inp.disabled,
            rsvTerm: ds.rsvterm ? Number(ds.rsvterm) : null,
            categoryCd: ds.categorycd || null,
          };
        }
      })
    );
    for (const o of menuOptions) {
      if (!o.value) continue;
      result.push({
        external_menu_id: o.value,
        setmenu_id: null,
        menu_id: o.value,
        menu_category_cd: o.categoryCd,
        menu_name: o.label,
        rsv_term: o.rsvTerm,
        price: null,
        active: !o.disabled,
      });
    }
  }

  logger.info({ count: result.length }, "fetched salonboard menus");
  return result;
}
