import type { Page, Frame } from "playwright";
import { logger } from "../logger.js";

export interface FindReservationInput {
  date: string;                       // YYYYMMDD
  time?: string | number;             // HHMM
  customerName?: string;
  stylistId?: string | number;
  stylistName?: string;
  menuName?: string;
}

export interface FoundReservation {
  external_reservation_id: string | null;
  date: string;
  time: string | null;
  stylistName: string | null;
  customerName: string | null;
  menu: string | null;
  raw: string;
}

const SCHEDULE_URLS = [
  (d: string) => `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=${d}`,
  (d: string) => `https://salonboard.com/CLP/bt/schedule/salonScheduleWeek/?date=${d}`,
  (d: string) => `https://salonboard.com/CLP/bt/schedule/salonScheduleDay/?date=${d}`,
];

const ACTION_BUTTON_TEXTS = new Set([
  "詳細", "変更", "予約登録", "キャンセル", "メモ編集",
  "お客様情報", "カルテ", "受付チェック", "会計", "新規予約",
  "予約", "コピー", "削除",
]);

function expectedDateLabel(yyyymmdd: string): string {
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${m}月${d}日`;
}

function isErrorPage(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("指定されたurlは存在しません") ||
    lower.includes("ページが見つかりません") ||
    lower.includes("not found");
}

async function navigateToDate(
  page: Page,
  date: string,
): Promise<{ url: string; title: string; bodySnippet: string; matched: boolean }> {
  const want = expectedDateLabel(date);
  for (const build of SCHEDULE_URLS) {
    const url = build(date);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      if (/\/login/i.test(page.url())) {
        return { url: page.url(), title: "", bodySnippet: "", matched: false };
      }
      const title = await page.title().catch(() => "");
      const body = await page.locator("body").innerText().catch(() => "");
      const matched = !isErrorPage(body) && (body.includes(want) || body.includes("予約"));
      logger.info({
        tried: url, finalUrl: page.url(), title, matched,
        snippet: body.slice(0, 300), errorPage: isErrorPage(body),
      }, "findReservations: nav attempt");
      if (matched) return { url: page.url(), title, bodySnippet: body.slice(0, 600), matched: true };
    } catch (e) {
      logger.warn({ url, e: e instanceof Error ? e.message : String(e) }, "findReservations: nav failed");
    }
  }
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText().catch(() => "");
  return { url: page.url(), title, bodySnippet: body.slice(0, 600), matched: !isErrorPage(body) };
}

function normalize(s: string): string {
  return s.replace(/[\s　]/g, "").toLowerCase();
}

function extractCustomerName(raw: string): string | null {
  // "てすと太郎（テスト）様" → "てすと太郎"
  const m = raw.match(/^([^（(]+?)(?:[（(][^）)]*[）)])?\s*様/);
  if (m) return m[1].trim();
  return raw.replace(/様$/, "").trim() || null;
}

/**
 * スケジュール画面の予約枠を探してクリックし、ポップアップから情報を抽出する
 */
async function findSlotsAndExtractFromPopups(
  page: Page,
  input: FindReservationInput,
  wantTimeFmt: string | null,
  wantName: string | null,
): Promise<FoundReservation[]> {
  const results: FoundReservation[] = [];

  // 候補となる予約セルを取得（td.reserved系、a[onclick*="reserve"]系）
  const slots = await page.evaluate(() => {
    const out: { idx: number; tag: string; text: string; html: string; hasOnclick: boolean }[] = [];
    const sels = [
      "td.reserved", "td.fcReserved", "td.rsv", "td.reservation",
      'a[onclick*="reserve" i]', 'a[onclick*="rsv" i]',
      '[class*="reserve" i][class*="cell" i]',
      'div[class*="reserved" i]',
    ];
    const elems = new Set<Element>();
    for (const s of sels) {
      try { document.querySelectorAll(s).forEach((e) => elems.add(e)); } catch {}
    }
    let i = 0;
    for (const el of elems) {
      const text = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      // 操作ボタン単体は除外
      if (text.length < 1) continue;
      out.push({
        idx: i++,
        tag: el.tagName,
        text: text.slice(0, 100),
        html: (el as HTMLElement).outerHTML.slice(0, 200),
        hasOnclick: !!el.getAttribute("onclick"),
      });
      (el as HTMLElement).setAttribute("data-sb-find-idx", String(i - 1));
    }
    return out;
  }).catch(() => []);

  logger.info({ slotCount: slots.length, slotSample: slots.slice(0, 8) }, "findReservations: slots discovered");

  if (slots.length === 0) {
    return results;
  }

  // 時刻フィルタで候補を絞る（あれば）
  const candidateIdxs = slots
    .filter((s) => {
      if (!wantTimeFmt) return true;
      // セルのテキストに時刻が含まれているか、含まれていなくても全部試す対象
      return true;
    })
    .map((s) => s.idx)
    .slice(0, 12); // 最大12件まで試行

  for (const idx of candidateIdxs) {
    try {
      const slotInfo = slots.find((s) => s.idx === idx);
      const sel = `[data-sb-find-idx="${idx}"]`;
      const exists = await page.locator(sel).count();
      if (!exists) continue;

      // ポップアップを閉じる試行（前回のポップアップが残っている場合）
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);

      await page.locator(sel).first().click({ timeout: 3000 }).catch(() => {});
      // ポップアップ要素を待つ
      const popupAppeared = await page
        .waitForSelector("#reserveItemName, .reserveCustomerName, #reserveItemUketsuke", { timeout: 2500, state: "visible" })
        .then(() => true)
        .catch(() => false);

      if (!popupAppeared) {
        logger.info({ idx, clickedSlotText: slotInfo?.text, popupVisible: false }, "findReservations: no popup after click");
        continue;
      }

      const popupData = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s);
        const txt = (s: string) => {
          const el = q(s) as HTMLElement | null;
          return el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "";
        };
        const reserveCustomerName = txt(".reserveCustomerName") || txt("#reserveItemName");
        // メニュー、スタッフ等は ID が不明のためポップアップ全体テキストから抽出も保険として
        const popupRoot = q("#reserveItemName")?.closest(".mod_column02, .mod_box_01, .modalContents, .pop, [class*='popup' i]") as HTMLElement | null;
        const popupOuterHTML = popupRoot ? popupRoot.outerHTML.slice(0, 2000) : "";
        const popupText = popupRoot ? (popupRoot.innerText || "").replace(/\s+/g, " ").trim() : "";

        // 詳細・変更ボタン
        const findBtn = (label: string): { html: string; href: string; onclick: string } | null => {
          const all = Array.from(document.querySelectorAll("a, button"));
          for (const el of all) {
            const t = ((el as HTMLElement).innerText || el.textContent || "").trim();
            if (t === label) {
              return {
                html: (el as HTMLElement).outerHTML.slice(0, 300),
                href: (el as HTMLAnchorElement).getAttribute("href") || "",
                onclick: el.getAttribute("onclick") || "",
              };
            }
          }
          return null;
        };
        const detailBtn = findBtn("詳細");
        const changeBtn = findBtn("変更");

        // reserveId 抽出
        const combined = `${detailBtn?.href || ""} ${detailBtn?.onclick || ""} ${changeBtn?.href || ""} ${changeBtn?.onclick || ""} ${popupOuterHTML}`;
        const m = combined.match(/(?:rsvId|reserveId|reserve_id|reservationId)['"=:\s]+([A-Z0-9]+)/i)
          || combined.match(/\/(BE\d{6,})/i)
          || combined.match(/['"]([A-Z0-9]{8,})['"]/);
        const extractedReserveId = m ? m[1] : null;

        // hidden inputs
        const hiddens: Record<string, string> = {};
        document.querySelectorAll("input[type='hidden']").forEach((inp) => {
          const name = (inp as HTMLInputElement).name;
          const v = (inp as HTMLInputElement).value;
          if (name && /reserve|rsv/i.test(name) && v) hiddens[name] = v;
        });

        return {
          reserveCustomerName,
          popupText: popupText.slice(0, 1000),
          popupOuterHTML,
          detailBtn,
          changeBtn,
          extractedReserveId,
          hiddens,
        };
      }).catch(() => null);

      logger.info({
        idx,
        clickedSlotText: slotInfo?.text,
        popupVisible: true,
        reserveCustomerName: popupData?.reserveCustomerName,
        popupTextSnippet: popupData?.popupText?.slice(0, 300),
        detailButton: popupData?.detailBtn?.html,
        changeButton: popupData?.changeBtn?.html,
        extractedReserveId: popupData?.extractedReserveId,
        hiddens: popupData?.hiddens,
      }, "findReservations: popup data");

      if (!popupData || !popupData.reserveCustomerName) {
        await page.keyboard.press("Escape").catch(() => {});
        continue;
      }

      const customerName = extractCustomerName(popupData.reserveCustomerName);
      const popupText = popupData.popupText || "";
      const timeMatch = (slotInfo?.text || "").match(/(\d{1,2}):(\d{2})/) || popupText.match(/(\d{1,2}):(\d{2})/);
      const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null;

      // 顧客名一致判定
      let nameOk = true;
      if (wantName && customerName) {
        const a = normalize(customerName);
        const b = normalize(wantName);
        nameOk = a.includes(b) || b.includes(a);
      }

      // 時刻一致判定
      let timeOk = true;
      if (wantTimeFmt && time) {
        timeOk = time === wantTimeFmt;
      }

      const reserveId = popupData.extractedReserveId
        || Object.values(popupData.hiddens || {})[0]
        || null;

      // 最低条件: 顧客名が存在
      if (!customerName) {
        await page.keyboard.press("Escape").catch(() => {});
        continue;
      }

      if (nameOk && timeOk) {
        results.push({
          external_reservation_id: reserveId,
          date: input.date,
          time,
          stylistName: null,
          customerName,
          menu: null,
          raw: (popupData.popupText || popupData.reserveCustomerName).slice(0, 300),
        });
        logger.info({ reserveId, customerName, time }, "findReservations: matched");
      }

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(120);

      // 1件見つかれば早期return
      if (results.length >= 1 && wantName) break;
    } catch (e) {
      logger.warn({ idx, e: e instanceof Error ? e.message : String(e) }, "findReservations: slot click failed");
    }
  }

  return results;
}

export async function findReservations(
  page: Page,
  input: FindReservationInput,
): Promise<FoundReservation[]> {
  logger.info({ input }, "findReservations: start");

  const wantTime = input.time != null ? String(input.time).padStart(4, "0") : null;
  const wantTimeFmt = wantTime ? `${wantTime.slice(0, 2)}:${wantTime.slice(2, 4)}` : null;
  const wantName = input.customerName?.trim() || null;

  const nav = await navigateToDate(page, input.date);
  if (/\/login/i.test(page.url())) throw new Error("session_expired_in_find");
  logger.info({
    finalUrl: nav.url, title: nav.title, bodySnippet: nav.bodySnippet,
    expectedDateLabel: expectedDateLabel(input.date), matched: nav.matched,
  }, "findReservations: navigation result");

  if (!nav.matched) {
    logger.warn({ finalUrl: nav.url }, "findReservations: page did not match expected date");
    return [];
  }

  const results = await findSlotsAndExtractFromPopups(page, input, wantTimeFmt, wantName);

  logger.info({
    count: results.length,
    sample: results.slice(0, 3).map((r) => ({
      id: r.external_reservation_id, name: r.customerName, time: r.time,
    })),
  }, "findReservations: done");

  return results;
}
