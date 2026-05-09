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
 * customerName を含む要素を探し、クリック可能な親をクリックしてポップアップから情報を抽出する
 */
async function findSlotsAndExtractFromPopups(
  page: Page,
  input: FindReservationInput,
  wantTimeFmt: string | null,
  wantName: string | null,
): Promise<FoundReservation[]> {
  const results: FoundReservation[] = [];

  if (!wantName) {
    logger.warn({}, "findReservations: no customerName provided, cannot locate slot block");
    return results;
  }

  // customerName を含む表示要素を探し、その親階層から「予約ブロックらしい」クリック可能な親を選ぶ
  const candidates = await page.evaluate((nameRaw: string) => {
    const ACTION_TEXTS = new Set([
      "詳細", "変更", "予約登録", "キャンセル", "メモ編集", "お客様情報",
      "カルテ", "受付チェック", "会計", "新規予約", "予約", "コピー", "削除",
      "予約一覧", "一括停止・再開", "確定", "スケジュール", "毎月の受付設定",
      "アラート", "印刷", "アイコン説明", "最新を表示",
    ]);
    const norm = (s: string) => s.replace(/[\s　]/g, "").toLowerCase();
    const wantNorm = norm(nameRaw);

    const all = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
    // テキストノードレベルで「顧客名」を含む最小要素群を抽出
    const hits: HTMLElement[] = [];
    for (const el of all) {
      // 子要素にテキストが分散していると拾えないので innerText も見る
      const own = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!own) continue;
      if (norm(own).includes(wantNorm) === false) continue;
      // ヘッダー/ヘルプ系のリンクは除外
      if (ACTION_TEXTS.has(own.trim())) continue;
      // 自身より小さい子に同じテキストがあれば、こちらは親なので一旦保留
      hits.push(el);
    }
    // 「最も小さい(最も内側の)要素」を優先：子孫に同じヒットがあれば自分は捨てる
    const set = new Set(hits);
    const innermost = hits.filter((h) => {
      for (const c of Array.from(h.querySelectorAll("*"))) {
        if (set.has(c as HTMLElement)) return false;
      }
      return true;
    });

    const out: any[] = [];
    let idx = 0;
    for (const hit of innermost.slice(0, 8)) {
      const parents: HTMLElement[] = [];
      let cur: HTMLElement | null = hit;
      for (let i = 0; i < 6 && cur; i++) {
        parents.push(cur);
        cur = cur.parentElement;
      }
      // クリック対象を選ぶ: bounding box が十分大きい / class に schedule|reserve|appoint|panel|item|box / onclick あり
      let chosen: HTMLElement | null = null;
      for (const p of parents) {
        const rect = p.getBoundingClientRect();
        const cls = (p.className || "").toString().toLowerCase();
        const hasOnclick = !!p.getAttribute("onclick");
        const hasReserveClass = /schedule|reserve|appoint|panel|item|box|sch_|reserved/.test(cls);
        const bigEnough = rect.width >= 60 && rect.height >= 20;
        if ((hasOnclick || hasReserveClass) && bigEnough) {
          chosen = p;
          break;
        }
      }
      // フォールバック: 適度なサイズの最初の親
      if (!chosen) {
        for (const p of parents) {
          const rect = p.getBoundingClientRect();
          if (rect.width >= 80 && rect.height >= 24 && rect.width < 600 && rect.height < 400) {
            chosen = p;
            break;
          }
        }
      }
      if (!chosen) chosen = hit;

      const attr = `data-sb-find-idx`;
      chosen.setAttribute(attr, String(idx));
      const rect = chosen.getBoundingClientRect();

      out.push({
        idx,
        nameHitOuterHTML: hit.outerHTML.slice(0, 300),
        parent1OuterHTML: parents[1]?.outerHTML.slice(0, 400) || "",
        parent2OuterHTML: parents[2]?.outerHTML.slice(0, 400) || "",
        parent3OuterHTML: parents[3]?.outerHTML.slice(0, 400) || "",
        parent4OuterHTML: parents[4]?.outerHTML.slice(0, 400) || "",
        parent5OuterHTML: parents[5]?.outerHTML.slice(0, 400) || "",
        chosenClickableOuterHTML: chosen.outerHTML.slice(0, 500),
        chosenClickableBoundingBox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        chosenText: (chosen.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
      });
      idx++;
    }
    return out;
  }, wantName).catch((e) => {
    logger.warn({ e: e instanceof Error ? e.message : String(e) }, "findReservations: candidate eval failed");
    return [] as any[];
  });

  logger.info({ candidateCount: candidates.length, candidates }, "findReservations: name-based candidates");

  if (candidates.length === 0) {
    return results;
  }

  for (const cand of candidates) {
    try {
      const sel = `[data-sb-find-idx="${cand.idx}"]`;
      const exists = await page.locator(sel).count();
      if (!exists) continue;

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);

      const target = page.locator(sel).first();
      await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await target.click({ force: true, timeout: 3000 }).catch(async (e) => {
        logger.warn({ idx: cand.idx, e: e instanceof Error ? e.message : String(e) }, "findReservations: click failed, retry parent");
        // 親をクリックでリトライ
        await page.evaluate((s) => {
          const el = document.querySelector(s) as HTMLElement | null;
          el?.parentElement?.click();
        }, sel).catch(() => {});
      });

      const popupAppeared = await page
        .waitForSelector("#reserveItemName, .reserveCustomerName, #reserveItemUketsuke", {
          timeout: 3000,
          state: "visible",
        })
        .then(() => true)
        .catch(() => false);

      if (!popupAppeared) {
        logger.info({ idx: cand.idx, popupVisible: false, chosenText: cand.chosenText }, "findReservations: no popup after click");
        continue;
      }

      const popupData = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s);
        const txt = (s: string) => {
          const el = q(s) as HTMLElement | null;
          return el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "";
        };
        const reserveCustomerName = txt(".reserveCustomerName") || txt("#reserveItemName");
        const popupRoot =
          (q("#reserveItemName")?.closest(".mod_column02, .mod_box_01, .modalContents, .pop, [class*='popup' i]") as HTMLElement | null) ||
          (q(".reserveCustomerName")?.closest(".mod_column02, .mod_box_01, .modalContents, .pop, [class*='popup' i]") as HTMLElement | null);
        const popupOuterHTML = popupRoot ? popupRoot.outerHTML.slice(0, 2000) : "";
        const popupText = popupRoot ? (popupRoot.innerText || "").replace(/\s+/g, " ").trim() : "";

        const findBtn = (label: string) => {
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

        const combined = `${detailBtn?.href || ""} ${detailBtn?.onclick || ""} ${changeBtn?.href || ""} ${changeBtn?.onclick || ""} ${popupOuterHTML}`;
        const m =
          combined.match(/(?:rsvId|reserveId|reserve_id|reservationId)['"=:\s]+([A-Z0-9]+)/i) ||
          combined.match(/\/(BE\d{6,})/i) ||
          combined.match(/['"]([A-Z0-9]{8,})['"]/);
        const extractedReserveId = m ? m[1] : null;

        const hiddens: Record<string, string> = {};
        document.querySelectorAll("input[type='hidden']").forEach((inp) => {
          const name = (inp as HTMLInputElement).name;
          const v = (inp as HTMLInputElement).value;
          if (name && /reserve|rsv/i.test(name) && v) hiddens[name] = v;
        });

        return { reserveCustomerName, popupText: popupText.slice(0, 1000), popupOuterHTML, detailBtn, changeBtn, extractedReserveId, hiddens };
      }).catch(() => null);

      logger.info({
        idx: cand.idx,
        chosenText: cand.chosenText,
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
      const timeMatch = popupText.match(/(\d{1,2}):(\d{2})/) || (cand.chosenText || "").match(/(\d{1,2}):(\d{2})/);
      const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null;

      let nameOk = true;
      if (wantName && customerName) {
        const a = normalize(customerName);
        const b = normalize(wantName);
        nameOk = a.includes(b) || b.includes(a);
      }
      let timeOk = true;
      if (wantTimeFmt && time) {
        timeOk = time === wantTimeFmt;
      }

      const reserveId = popupData.extractedReserveId || Object.values(popupData.hiddens || {})[0] || null;

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
        logger.info({ reserveId, customerName, time, idMissing: !reserveId }, reserveId ? "findReservations: matched" : "findReservations: match_but_id_missing");
      }

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(120);

      if (results.length >= 1) break;
    } catch (e) {
      logger.warn({ idx: cand.idx, e: e instanceof Error ? e.message : String(e) }, "findReservations: candidate processing failed");
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
