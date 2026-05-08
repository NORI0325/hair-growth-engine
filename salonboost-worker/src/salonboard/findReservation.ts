import type { Page, Frame } from "playwright";
import { logger } from "../logger.js";

export interface FindReservationInput {
  date: string;                       // YYYYMMDD
  time?: string | number;             // HHMM
  customerName?: string;
  stylistId?: string | number;
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

function expectedDateLabel(yyyymmdd: string): string {
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${m}月${d}日`;
}

function isErrorPage(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("指定されたurlは存在しません") ||
    lower.includes("エラー") ||
    lower.includes("error") ||
    lower.includes("not found") ||
    lower.includes("ページが見つかりません");
}

function pageLooksValid(
  body: string,
  wantLabel: string,
  wantTimeFmt: string | null,
  wantName: string | null,
): boolean {
  if (isErrorPage(body)) return false;
  if (body.includes(wantLabel)) return true;
  if (wantTimeFmt && body.includes(wantTimeFmt)) return true;
  if (wantName && body.includes(wantName)) return true;
  // salonSchedule ページの特徴: 予約表らしい要素があるか
  if (body.includes("予約") && body.includes(":")) return true;
  return false;
}

async function navigateToDate(
  page: Page,
  date: string,
  wantTimeFmt: string | null,
  wantName: string | null,
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
      const matched = pageLooksValid(body, want, wantTimeFmt, wantName);
      logger.info({
        tried: url, finalUrl: page.url(), title, matched, wantLabel: want,
        snippet: body.slice(0, 300), errorPage: isErrorPage(body),
      }, "findReservations: nav attempt");
      if (matched) return { url: page.url(), title, bodySnippet: body.slice(0, 600), matched: true };
    } catch (e) {
      logger.warn({ url, e: e instanceof Error ? e.message : String(e) }, "findReservations: nav failed");
    }
  }

  // フォーム送信フォールバック: salonSchedule の date input を直接書き換えて submit
  try {
    const fallbackUrl = SCHEDULE_URLS[0](date);
    await page.goto(fallbackUrl, { waitUntil: "domcontentloaded" });
    const submitted = await page.evaluate((d) => {
      const forms = Array.from(document.querySelectorAll("form")) as HTMLFormElement[];
      for (const f of forms) {
        const inp = f.querySelector('input[name="date"], input[name="targetDate"]') as HTMLInputElement | null;
        if (inp) {
          inp.value = d;
          f.submit();
          return f.action || true;
        }
      }
      return false;
    }, date);
    logger.info({ submitted }, "findReservations: form submit fallback");
    if (submitted) {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    }
  } catch (e) {
    logger.warn({ e: e instanceof Error ? e.message : String(e) }, "findReservations: form fallback failed");
  }

  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText().catch(() => "");
  const matched = pageLooksValid(body, want, wantTimeFmt, wantName);
  return { url: page.url(), title, bodySnippet: body.slice(0, 600), matched };
}

async function dumpFrame(frame: Page | Frame, label: string, want: { time: string | null; name: string | null }) {
  const counts = await frame.evaluate(() => ({
    aTotal: document.querySelectorAll("a").length,
    aWithHref: document.querySelectorAll("a[href]").length,
    aReserveLike: document.querySelectorAll(
      'a[href*="reserve" i], a[href*="rsv" i], a[href*="reservation" i], a[href*="detail" i], a[href*="edit" i]',
    ).length,
    onclickRsv: document.querySelectorAll('[onclick*="rsv" i], [onclick*="reserve" i]').length,
    tdReserved: document.querySelectorAll("td.reserved, td.rsv, td.fcReserved, td.reservation").length,
    table: document.querySelectorAll("table").length,
    iframe: document.querySelectorAll("iframe").length,
  })).catch(() => null);
  logger.info({ label, counts }, "findReservations: frame counts");

  const allHrefs = await frame.evaluate(() => {
    const arr = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    return arr.map((a) => a.getAttribute("href") || "").filter((h) => /reserve|rsv|reservation|detail|edit/i.test(h)).slice(0, 30);
  }).catch(() => []);
  logger.info({ label, reserveLikeHrefs: allHrefs }, "findReservations: reserve-like hrefs");

  if (want.name) {
    const nameHits = await frame.evaluate((n) => {
      const out: string[] = [];
      const all = document.querySelectorAll("td, a, div, span, li");
      for (const el of all) {
        const t = ((el as HTMLElement).innerText || el.textContent || "").trim();
        if (t && t.includes(n) && t.length < 200) {
          out.push(t.replace(/\s+/g, " "));
          if (out.length >= 8) break;
        }
      }
      return out;
    }, want.name).catch(() => []);
    logger.info({ label, name: want.name, nameHits }, "findReservations: nameHits");
  }

  if (want.time) {
    const timeHits = await frame.evaluate((t) => {
      const out: { tag: string; text: string; html: string }[] = [];
      const all = document.querySelectorAll("td, a, div, span, li");
      for (const el of all) {
        const text = ((el as HTMLElement).innerText || el.textContent || "").trim();
        if (text && text.includes(t) && text.length < 200) {
          out.push({
            tag: el.tagName,
            text: text.replace(/\s+/g, " "),
            html: (el as HTMLElement).outerHTML.slice(0, 200),
          });
          if (out.length >= 6) break;
        }
      }
      return out;
    }, want.time).catch(() => []);
    logger.info({ label, time: want.time, timeHits }, "findReservations: timeHits");
  }
}

async function extractCandidatesFromFrame(frame: Page | Frame): Promise<Array<{ reserveId: string | null; href: string | null; onclick: string | null; rowText: string; cellText: string }>> {
  return await frame.evaluate(() => {
    const results: Array<{ reserveId: string | null; href: string | null; onclick: string | null; rowText: string; cellText: string }> = [];
    const seen = new Set<Element>();
    const push = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      const href = (el as HTMLAnchorElement).getAttribute?.("href") || null;
      const onclick = el.getAttribute("onclick") || null;
      const combined = `${href || ""} ${onclick || ""}`;
      const m = combined.match(/(?:rsvId|reserveId|reserve_id|reservationId)['"=:\s]+([A-Z0-9]+)/i)
        || combined.match(/\/(BE\d{6,})/i);
      const cellText = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      const row = el.closest("tr,td,div,li");
      const rowText = ((row as HTMLElement | null)?.innerText || row?.textContent || "").replace(/\s+/g, " ").trim();
      results.push({ reserveId: m?.[1] ?? null, href, onclick, rowText, cellText });
    };
    document.querySelectorAll(
      'a[href*="reserve" i], a[href*="rsv" i], a[href*="reservation" i], a[href*="detail" i], a[href*="edit" i]'
    ).forEach(push);
    document.querySelectorAll('[onclick*="rsv" i], [onclick*="reserve" i], [onclick*="reservation" i]').forEach(push);
    document.querySelectorAll("td.reserved, td.rsv, td.fcReserved, td.reservation").forEach(push);
    return results;
  }).catch(() => []);
}

export async function findReservations(
  page: Page,
  input: FindReservationInput,
): Promise<FoundReservation[]> {
  logger.info({ input }, "findReservations: start");

  const nav = await navigateToDate(page, input.date);
  if (/\/login/i.test(page.url())) throw new Error("session_expired_in_find");
  logger.info({
    finalUrl: nav.url, title: nav.title, bodySnippet: nav.bodySnippet,
    expectedDateLabel: expectedDateLabel(input.date), dateLabelMatched: nav.matched,
  }, "findReservations: navigation result");

  const wantTime = input.time != null ? String(input.time).padStart(4, "0") : null;
  const wantTimeFmt = wantTime ? `${wantTime.slice(0, 2)}:${wantTime.slice(2, 4)}` : null;
  const wantName = input.customerName?.trim() || null;

  // メインフレーム + 全iframe を走査
  const frames: Array<{ name: string; frame: Page | Frame }> = [{ name: "main", frame: page }];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    frames.push({ name: f.url() || "iframe", frame: f });
  }
  logger.info({ frameCount: frames.length, frames: frames.map((f) => f.name) }, "findReservations: frames");

  const allCandidates: Array<{ reserveId: string | null; href: string | null; onclick: string | null; rowText: string; cellText: string }> = [];
  for (const { name, frame } of frames) {
    await dumpFrame(frame, name, { time: wantTimeFmt, name: wantName });
    const cands = await extractCandidatesFromFrame(frame);
    logger.info({ frame: name, candidateCount: cands.length }, "findReservations: frame candidates");
    for (const [i, c] of cands.slice(0, 5).entries()) {
      logger.info({
        frame: name, idx: i, reserveId: c.reserveId,
        href: c.href?.slice(0, 140),
        onclick: c.onclick?.slice(0, 140),
        cellText: c.cellText.slice(0, 100),
        rowText: c.rowText.slice(0, 200),
      }, "findReservations: candidate");
    }
    allCandidates.push(...cands);
  }

  // 重複除去
  const seen = new Set<string>();
  const unique = allCandidates.filter((it) => {
    const k = it.reserveId || `${it.href || ""}|${it.rowText.slice(0, 40)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const parsed: FoundReservation[] = unique.map((it) => ({
    external_reservation_id: it.reserveId,
    date: input.date,
    time: extractTime(it.rowText) || extractTime(it.cellText),
    stylistName: null,
    customerName: extractName(it.rowText) || extractName(it.cellText),
    menu: null,
    raw: (it.rowText || it.cellText).slice(0, 300),
  }));

  logger.info({
    parsedCount: parsed.length,
    extractedTimes: parsed.map((p) => p.time).slice(0, 8),
    extractedNames: parsed.map((p) => p.customerName).slice(0, 8),
    extractedIds: parsed.map((p) => p.external_reservation_id).slice(0, 8),
  }, "findReservations: parsed");

  const filtered = parsed.filter((r) => {
    if (wantTimeFmt && r.time && r.time !== wantTimeFmt) return false;
    if (wantName && r.customerName) {
      const a = normalize(r.customerName);
      const b = normalize(wantName);
      if (!a.includes(b) && !b.includes(a)) return false;
    }
    return true;
  });

  logger.info({ filteredCount: filtered.length, wantTimeFmt, wantName }, "findReservations: filtered");
  return filtered;
}

function normalize(s: string): string {
  return s.replace(/[\s　]/g, "").toLowerCase();
}

function extractTime(text: string): string | null {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function extractName(text: string): string | null {
  const cleaned = text
    .replace(/予約登録|キャンセル|変更|詳細|新規|空き|休み|休業|ブロック/g, "")
    .replace(/\d{1,2}:\d{2}/g, "")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > 60) return cleaned.slice(0, 60);
  return cleaned;
}
