import type { Page } from "playwright";
import { logger } from "../logger.js";

export interface DayReservation {
  external_reservation_id: string | null;
  date: string; // YYYYMMDD
  time: string | null; // HH:MM
  end_time?: string | null;
  duration_minutes?: number | null;
  customerName: string | null;
  menu: string | null;
  stylistName: string | null;
  raw: string;
  detail_href?: string | null;
  detail_url?: string | null;
  time_source?: "popup" | "detail" | "not_fetched_limit" | null;
  detail_fetch_skipped_reason?: string | null;
  detail_fetch_error?: string | null;
  status?: string | null;
  route?: string | null;
  source?: string | null;
  coupon_name?: string | null;
  stylist_id?: string | null;
  panel_update?: string | null;
  reserve_type?: string | null;
  payment_type?: string | null;
  parser_warnings?: string[];
  needs_review_reason?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

export type CandidateStage = "candidate_extract" | "panel_reserve" | "popup_parse" | "reservation_list" | "detail_fetch" | "detail_parse";

export interface CandidateDiagnostic {
  reserveId: string | null;
  reason: string;
  source: string;
  snippet: string;
  stage: CandidateStage;
}

export interface ListDayReservationsDiagnostics {
  date: string;
  detected_count: number;
  parsed_count: number;
  skipped_count: number;
  failed_count: number;
  skipped_candidates: CandidateDiagnostic[];
  failed_candidates: CandidateDiagnostic[];
  detail_fetch_limited_count: number;
  opened_urls: string[];
  view_type: string[];
  schedule_detected_count: number;
  panel_reserve_detected_count: number;
  reservation_list_detected_count: number;
  deduped_count: number;
  fallback_used_count: number;
}

export interface ListDayReservationsResult {
  items: DayReservation[];
  diagnostics: ListDayReservationsDiagnostics;
}

type Candidate = {
  idx: number;
  text: string;
  snippet: string;
  reserveId: string | null;
  detailHref: string | null;
  source: string;
  time?: string | null;
  panelDate?: string | null;
  status?: string | null;
  route?: string | null;
  stylistName?: string | null;
  stylistId?: string | null;
  menu?: string | null;
  customerName?: string | null;
  panelUpdate?: string | null;
  reserveType?: string | null;
};

const DETAIL_FETCH_DAILY_LIMIT = 10;
const MAX_DIAGNOSTIC_CANDIDATES = 50;

const SCHEDULE_URLS = [
  {
    viewType: "salonSchedule",
    build: (d: string) => `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=${d}`,
  },
  {
    viewType: "salonScheduleDay",
    build: (d: string) => `https://salonboard.com/CLP/bt/schedule/salonScheduleDay/?date=${d}`,
  },
];

const RESERVATION_LIST_BASE_URLS = [
  "https://salonboard.com/CLP/bt/reserve/",
  "https://salonboard.com/CLP/bt/reserve/net/",
  "https://salonboard.com/CLP/bt/reserve/net/reserveList/",
  "https://salonboard.com/CLP/bt/reserve/net/reserveList",
];

function clip(value: string | null | undefined, length = 180): string {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, length);
}

function expectedDateLabel(yyyymmdd: string): string {
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${m}\u6708${d}\u65e5`;
}

function isErrorPage(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("not found") ||
    lower.includes("404") ||
    body.includes("\u30da\u30fc\u30b8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093") ||
    body.includes("\u6307\u5b9a\u3055\u308c\u305furl\u306f\u5b58\u5728\u3057\u307e\u305b\u3093");
}

function addDiagnostic(
  list: CandidateDiagnostic[],
  entry: CandidateDiagnostic,
): void {
  if (list.length >= MAX_DIAGNOSTIC_CANDIDATES) return;
  list.push({ ...entry, snippet: clip(entry.snippet, 220) });
}

function addWarning(item: DayReservation, warning: string): void {
  item.parser_warnings = Array.from(new Set([...(item.parser_warnings || []), warning]));
  if (!item.needs_review_reason) item.needs_review_reason = warning;
}

function extractReserveId(text: string | null | undefined): string | null {
  const raw = text || "";
  const idByName = raw.match(/(?:reserveId|rsvId|reserve_id|reservationId|reserveNo)["'=:\s]*([A-Z0-9]{8,})/i);
  if (idByName?.[1]) return idByName[1].toUpperCase();
  const bf = raw.match(/\bBF\d{6,}\b/i);
  if (bf?.[0]) return bf[0].toUpperCase();
  const generic = raw.match(/\b[A-Z]{2}\d{6,}\b/i);
  return generic?.[0]?.toUpperCase() || null;
}

function isDetailHref(href: string | null | undefined): boolean {
  return !!href && /(?:net\/reserveDetail|ext\/extReserveDetail|reserveDetail)\/?\?reserveId=/i.test(href);
}

function fallbackDetailUrl(reserveId: string): string {
  return `https://salonboard.com/CLP/bt/reserve/net/reserveDetail/?reserveId=${encodeURIComponent(reserveId)}`;
}

function resolveSalonboardUrl(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `https://salonboard.com${href}`;
  return `https://salonboard.com/CLP/bt/reserve/net/${href.replace(/^\/+/, "")}`;
}

function yyyymmddToIso(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function dateLabels(date: string): string[] {
  const y = date.slice(0, 4);
  const m = String(parseInt(date.slice(4, 6), 10));
  const d = String(parseInt(date.slice(6, 8), 10));
  const mm = date.slice(4, 6);
  const dd = date.slice(6, 8);
  return [
    date,
    `${y}-${mm}-${dd}`,
    `${y}/${mm}/${dd}`,
    `${y}\u5e74${m}\u6708${d}\u65e5`,
    `${m}\u6708${d}\u65e5`,
  ];
}

function hasTargetDateInUrl(url: string, date: string): boolean {
  return url.includes(date) || url.includes(yyyymmddToIso(date)) || url.includes(date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1/$2/$3"));
}

function appendDateParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

function buildDateListUrls(baseUrl: string, date: string): string[] {
  const iso = yyyymmddToIso(date);
  const out = new Set<string>();
  out.add(appendDateParam(baseUrl, "date", date));
  out.add(appendDateParam(baseUrl, "targetDate", date));
  out.add(appendDateParam(baseUrl, "rsvDate", date));
  out.add(appendDateParam(baseUrl, "reserveDate", date));
  out.add(appendDateParam(baseUrl, "visitDate", iso));
  const rangeUrl = new URL(baseUrl);
  rangeUrl.searchParams.set("fromDate", iso);
  rangeUrl.searchParams.set("toDate", iso);
  out.add(rangeUrl.toString());
  return Array.from(out);
}

function parseClock(text: string | null | undefined): string | null {
  const match = (text || "").match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

function parseCompactClock(text: string | null | undefined): string | null {
  const match = (text || "").trim().match(/^(\d{1,2})(\d{2})$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

function parseTimeRangeAndDuration(text: string | null | undefined): {
  start: string | null;
  end: string | null;
  duration: number | null;
} {
  const raw = text || "";
  const range = raw.match(/(\d{1,2}):(\d{2})\s*(?:[\uff5e\u301c~\-\u2013\u2014\u2015]|\u304b\u3089)\s*(\d{1,2}):(\d{2})/);
  const durationLabel = new RegExp("\\u65bd\\u8853\\u6642\\u9593\\s*[\\[\\uff3b\\(\\uff08\\:：]?\\s*(\\d{1,2}):(\\d{2})").exec(raw);
  let duration = durationLabel
    ? parseInt(durationLabel[1], 10) * 60 + parseInt(durationLabel[2], 10)
    : null;

  if (!range) return { start: null, end: null, duration };

  const start = `${range[1].padStart(2, "0")}:${range[2]}`;
  const end = `${range[3].padStart(2, "0")}:${range[4]}`;
  if (duration == null) {
    const startMinutes = parseInt(range[1], 10) * 60 + parseInt(range[2], 10);
    const endMinutes = parseInt(range[3], 10) * 60 + parseInt(range[4], 10);
    duration = endMinutes >= startMinutes
      ? endMinutes - startMinutes
      : endMinutes + 24 * 60 - startMinutes;
  }
  return { start, end, duration };
}

function parseCustomerName(text: string | null | undefined): string | null {
  const raw = clip(text, 120);
  const honorific = raw.match(/^(.+?)\s*\u69d8(?:\s|$|\uff08|\()/);
  if (honorific?.[1]) return honorific[1].trim();
  const samaAnywhere = raw.match(/([^\s\uff08\(]{1,40})\s*\u69d8/);
  if (samaAnywhere?.[1]) return samaAnywhere[1].trim();
  const sanAnywhere = raw.match(/([^\s\uff08\(]{1,40})\s*\u3055\u3093/);
  return sanAnywhere?.[1]?.trim() || null;
}

async function navigateToDate(
  page: Page,
  date: string,
  diagnostics: ListDayReservationsDiagnostics,
): Promise<boolean> {
  const want = expectedDateLabel(date);
  for (const view of SCHEDULE_URLS) {
    const url = view.build(date);
    diagnostics.opened_urls.push(url);
    diagnostics.view_type.push(view.viewType);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      if (/\/login/i.test(page.url())) return false;
      const body = await page.locator("body").innerText().catch(() => "");
      if (!isErrorPage(body) && (body.includes(want) || body.includes("\u4e88\u7d04"))) return true;
    } catch (e) {
      logger.warn({ url, e: e instanceof Error ? e.message : String(e) }, "listDayReservations: nav failed");
    }
  }
  return false;
}

function createEmptyDiagnostics(date: string): ListDayReservationsDiagnostics {
  return {
    date,
    detected_count: 0,
    parsed_count: 0,
    skipped_count: 0,
    failed_count: 0,
    skipped_candidates: [],
    failed_candidates: [],
    detail_fetch_limited_count: 0,
    opened_urls: [],
    view_type: [],
    schedule_detected_count: 0,
    panel_reserve_detected_count: 0,
    reservation_list_detected_count: 0,
    deduped_count: 0,
    fallback_used_count: 0,
  };
}

function mergeReservation(target: DayReservation, source: DayReservation): void {
  target.external_reservation_id ||= source.external_reservation_id;
  target.time ||= source.time;
  target.end_time ||= source.end_time;
  target.duration_minutes ??= source.duration_minutes ?? null;
  target.customerName ||= source.customerName;
  target.menu ||= source.menu;
  target.stylistName ||= source.stylistName;
  target.detail_href ||= source.detail_href;
  target.detail_url ||= source.detail_url;
  target.time_source ||= source.time_source;
  target.detail_fetch_skipped_reason ||= source.detail_fetch_skipped_reason;
  target.detail_fetch_error ||= source.detail_fetch_error;
  target.status ||= source.status;
  target.route ||= source.route;
  target.source ||= source.source;
  target.coupon_name ||= source.coupon_name;
  target.stylist_id ||= source.stylist_id;
  target.panel_update ||= source.panel_update;
  target.reserve_type ||= source.reserve_type;
  target.payment_type ||= source.payment_type;
  target.needs_review_reason ||= source.needs_review_reason;
  if (source.raw && !target.raw.includes(source.raw)) {
    target.raw = clip(`${target.raw} ${source.raw}`, 500);
  }
  if (source.parser_warnings?.length) {
    target.parser_warnings = Array.from(new Set([...(target.parser_warnings || []), ...source.parser_warnings]));
  }
  if (source.raw_payload) {
    target.raw_payload = { ...(target.raw_payload || {}), ...source.raw_payload };
  }
}

function resultKey(item: DayReservation): string {
  if (item.external_reservation_id) return `id:${item.external_reservation_id}`;
  return `fuzzy:${item.customerName || "unknown"}:${item.time || "unknown"}:${item.raw.slice(0, 80)}`;
}

function addResult(
  results: DayReservation[],
  resultMap: Map<string, DayReservation>,
  item: DayReservation,
): { item: DayReservation; inserted: boolean } {
  const key = resultKey(item);
  const existing = resultMap.get(key);
  if (existing) {
    mergeReservation(existing, item);
    return { item: existing, inserted: false };
  }
  results.push(item);
  resultMap.set(key, item);
  return { item, inserted: true };
}

function buildFallbackItem(date: string, cand: Candidate, warning: string): DayReservation {
  const item: DayReservation = {
    external_reservation_id: cand.reserveId,
    date: cand.panelDate || date,
    time: cand.time || parseClock(cand.text),
    customerName: cand.customerName || parseCustomerName(cand.text),
    menu: cand.menu || null,
    stylistName: cand.stylistName || null,
    raw: clip(cand.text || cand.snippet, 300),
    detail_href: cand.detailHref || (cand.reserveId ? fallbackDetailUrl(cand.reserveId) : null),
    time_source: (cand.time || parseClock(cand.text)) ? "popup" : null,
    status: cand.status || null,
    route: cand.route || null,
    source: cand.route || null,
    stylist_id: cand.stylistId || null,
    panel_update: cand.panelUpdate || null,
    reserve_type: cand.reserveType || null,
    parser_warnings: [warning],
    needs_review_reason: warning,
    raw_payload: {
      candidate_source: cand.source,
      candidate_snippet: clip(cand.snippet, 500),
      panel_date: cand.panelDate || null,
      panel_start_time: cand.time || null,
      panel_stylist_id: cand.stylistId || null,
      panel_update: cand.panelUpdate || null,
      panel_reserve_type: cand.reserveType || null,
    },
  };
  return item;
}

async function collectReservationListUrls(page: Page, date: string): Promise<string[]> {
  const discovered = await page.evaluate(() => {
    const urls = new Set<string>();
    for (const el of Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      const href = el.getAttribute("href") || "";
      const combined = `${text} ${href}`;
      if (!/(予約一覧|reserve\/|reserveList)/i.test(combined)) continue;
      if (/(reserveDetail|instantReserveChangeInput|reserveRegist|doRegister|cancel)/i.test(href)) continue;
      try {
        urls.add(new URL(href, location.href).toString());
      } catch (_) {
        // ignore invalid hrefs
      }
    }
    return Array.from(urls);
  }).catch(() => [] as string[]);

  const candidates = new Set<string>();
  for (const base of [...discovered, ...RESERVATION_LIST_BASE_URLS]) {
    if (!/^https?:\/\//i.test(base)) continue;
    if (hasTargetDateInUrl(base, date)) candidates.add(base);
    for (const url of buildDateListUrls(base, date)) candidates.add(url);
  }
  return Array.from(candidates).slice(0, 24);
}

async function collectReservationListCandidates(
  page: Page,
  date: string,
  diagnostics: ListDayReservationsDiagnostics,
): Promise<Candidate[]> {
  const urls = await collectReservationListUrls(page, date);
  const labels = dateLabels(date);
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    diagnostics.opened_urls.push(url);
    diagnostics.view_type.push("reservationList");
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      if (/\/login/i.test(page.url())) throw new Error("session_expired_in_reservation_list");
      const body = await page.locator("body").innerText().catch(() => "");
      if (isErrorPage(body)) {
        addDiagnostic(diagnostics.skipped_candidates, {
          reserveId: null,
          reason: "reservation_list_error_page",
          source: "reservation_list",
          snippet: `${url} ${body.slice(0, 120)}`,
          stage: "reservation_list",
        });
        continue;
      }

      const assumeDateFiltered = hasTargetDateInUrl(url, date);
      const found = await page.evaluate(({ targetLabels, assumeDateFiltered: allowWithoutDate }) => {
        type OutCandidate = {
          text: string;
          snippet: string;
          reserveId: string | null;
          detailHref: string | null;
          source: string;
          status?: string | null;
          route?: string | null;
          stylistName?: string | null;
          menu?: string | null;
          customerName?: string | null;
        };
        const normalize = (value: string | null | undefined) =>
          (value || "").replace(/\s+/g, " ").trim();
        const short = (value: string | null | undefined, len = 260) => normalize(value).slice(0, len);
        const findReserveId = (raw: string) => {
          const idByName = raw.match(/(?:reserveId|rsvId|reserve_id|reservationId|reserveNo)["'=:\s]*([A-Z0-9]{8,})/i);
          if (idByName?.[1]) return idByName[1].toUpperCase();
          const bf = raw.match(/\bBF\d{6,}\b/i);
          if (bf?.[0]) return bf[0].toUpperCase();
          const generic = raw.match(/\b[A-Z]{2}\d{6,}\b/i);
          return generic?.[0]?.toUpperCase() || null;
        };
        const findDetailHref = (raw: string) => {
          const direct = raw.match(/https?:\/\/[^'"\s<>]+(?:reserve\/)?(?:net\/reserveDetail|ext\/extReserveDetail|reserveDetail)\/?\?reserveId=[A-Z0-9]+/i);
          if (direct?.[0]) return direct[0].replace(/&amp;/g, "&");
          const relative = raw.match(/(?:\/CLP\/bt\/)?(?:reserve\/)?(?:net\/reserveDetail|ext\/extReserveDetail|reserveDetail)\/?\?reserveId=[A-Z0-9]+/i);
          if (relative?.[0]) {
            try { return new URL(relative[0].replace(/&amp;/g, "&"), location.href).href; } catch (_) { return relative[0].replace(/&amp;/g, "&"); }
          }
          return null;
        };
        const rowFor = (el: HTMLElement) =>
          (el.closest("tr, li, .mod_box_01, .mod_box_02, .reserve, .reserveList, .list, [class*='reserve' i], [class*='list' i]") as HTMLElement | null) ||
          el.parentElement ||
          el;
        const hasTargetDate = (text: string) => allowWithoutDate || targetLabels.some((label) => text.includes(label));
        const statusFrom = (text: string) => {
          for (const status of ["受付待ち", "確定", "会計済み", "キャンセル", "来店済み", "仮予約"]) {
            if (text.includes(status)) return status;
          }
          return null;
        };
        const routeFrom = (text: string) => {
          if (/HOT\s*PEPPER|Hot\s*Pepper|ホットペッパー/i.test(text)) return "HOT PEPPER Beauty";
          if (text.includes("電話")) return "電話";
          if (text.includes("サロンボード")) return "SALON BOARD";
          return null;
        };
        const stylistFrom = (text: string) => {
          if (text.includes("フリー予約") || text.includes("担当未定")) return "フリー予約（担当未定）";
          const match = text.match(/スタイリスト\s*[:：]?\s*([^\s]+)/);
          return match?.[1] || null;
        };
        const customerFrom = (text: string) => {
          const kanji = text.match(/氏名(?:（漢字）)?\s*[:：]?\s*([^\s]+)/);
          if (kanji?.[1]) return kanji[1].replace(/[様さん]+$/, "");
          const sama = text.match(/([^\s（(]{1,40})\s*様/);
          if (sama?.[1]) return sama[1];
          const san = text.match(/([^\s（(]{1,40})\s*さん/);
          return san?.[1] || null;
        };
        const menuFrom = (text: string) => {
          const menu = text.match(/メニュー\s*[:：]?\s*([^\n\r]+?)(?:\s{2,}|クーポン|スタイリスト|予約経路|$)/);
          return menu?.[1]?.trim() || null;
        };

        const candidates = new Map<string, OutCandidate>();
        for (const el of Array.from(document.querySelectorAll("a[href], [onclick], input, tr, li")) as HTMLElement[]) {
          const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
          const raw = `${href} ${el.getAttribute("onclick") || ""} ${el.getAttribute("value") || ""} ${el.outerHTML || ""}`;
          if (!/(reserveId|rsvId|reserveNo|reserveDetail|extReserveDetail|BF\d{6,})/i.test(raw)) continue;
          const reserveId = findReserveId(raw);
          const detailHref = findDetailHref(raw);
          if (!reserveId && !detailHref) continue;
          const row = rowFor(el);
          const rowText = short(row.innerText || row.textContent || el.textContent || "", 900);
          const rowHtml = (row.outerHTML || el.outerHTML || "").slice(0, 2500);
          if (!hasTargetDate(`${rowText} ${rowHtml}`)) continue;
          const id = reserveId || findReserveId(detailHref || "") || detailHref || rowText;
          if (!id) continue;
          candidates.set(id, {
            text: rowText,
            snippet: short(rowText || rowHtml, 260),
            reserveId,
            detailHref,
            source: "reservation_list",
            status: statusFrom(rowText),
            route: routeFrom(rowText),
            stylistName: stylistFrom(rowText),
            menu: menuFrom(rowText),
            customerName: customerFrom(rowText),
          });
        }
        return Array.from(candidates.values()).slice(0, 120);
      }, { targetLabels: labels, assumeDateFiltered });

      for (const cand of found) {
        const reserveId = cand.reserveId || extractReserveId(cand.detailHref);
        const key = reserveId || cand.detailHref || cand.snippet;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          idx: out.length,
          text: cand.text,
          snippet: cand.snippet,
          reserveId,
          detailHref: cand.detailHref || (reserveId ? fallbackDetailUrl(reserveId) : null),
          source: `reservation_list:${new URL(url).pathname}`,
          status: cand.status || null,
          route: cand.route || null,
          stylistName: cand.stylistName || null,
          menu: cand.menu || null,
          customerName: cand.customerName || null,
        });
      }
    } catch (e) {
      addDiagnostic(diagnostics.failed_candidates, {
        reserveId: null,
        reason: e instanceof Error ? e.message : String(e),
        source: "reservation_list",
        snippet: url,
        stage: "reservation_list",
      });
      if (e instanceof Error && e.message === "session_expired_in_reservation_list") throw e;
      logger.warn({ url, e: e instanceof Error ? e.message : String(e) }, "listDayReservations: reservation list fallback failed");
    }
  }

  return out;
}

export async function listDayReservations(page: Page, date: string): Promise<ListDayReservationsResult> {
  logger.info({ date }, "listDayReservations: start");
  const diagnostics = createEmptyDiagnostics(date);
  const ok = await navigateToDate(page, date, diagnostics);
  if (/\/login/i.test(page.url())) throw new Error("session_expired_in_list");
  if (!ok) {
    logger.warn({ url: page.url() }, "listDayReservations: page not matched");
    return { items: [], diagnostics };
  }

  const candidates = await page.evaluate(() => {
    type OutCandidate = {
      idx: number;
      text: string;
      snippet: string;
      reserveId: string | null;
      detailHref: string | null;
      source: string;
      time?: string | null;
      panelDate?: string | null;
      customerName?: string | null;
      stylistId?: string | null;
      panelUpdate?: string | null;
      reserveType?: string | null;
    };

    const ACTION_TEXTS = new Set([
      "\u8a73\u7d30", "\u5909\u66f4", "\u4e88\u7d04\u767b\u9332", "\u30ad\u30e3\u30f3\u30bb\u30eb",
      "\u30e1\u30e2\u7de8\u96c6", "\u304a\u5ba2\u69d8\u60c5\u5831", "\u30ab\u30eb\u30c6",
      "\u53d7\u4ed8\u30c1\u30a7\u30c3\u30af", "\u4f1a\u8a08", "\u65b0\u898f\u4e88\u7d04",
      "\u4e88\u7d04", "\u30b3\u30d4\u30fc", "\u524a\u9664", "\u4e88\u7d04\u4e00\u89a7",
      "\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb", "\u6700\u65b0\u3092\u8868\u793a",
    ]);
    const all = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
    const candidateMap = new Map<string, OutCandidate & { element: HTMLElement }>();
    let idx = 0;

    const normalize = (value: string | null | undefined) =>
      (value || "").replace(/\s+/g, " ").trim();
    const short = (value: string | null | undefined, len = 220) => normalize(value).slice(0, len);
    const findReserveId = (raw: string) => {
      const idByName = raw.match(/(?:reserveId|rsvId|reserve_id|reservationId|reserveNo)["'=:\s]*([A-Z0-9]{8,})/i);
      if (idByName?.[1]) return idByName[1].toUpperCase();
      const bf = raw.match(/\bBF\d{6,}\b/i);
      if (bf?.[0]) return bf[0].toUpperCase();
      const generic = raw.match(/\b[A-Z]{2}\d{6,}\b/i);
      return generic?.[0]?.toUpperCase() || null;
    };
    const compactClock = (raw: string | null | undefined) => {
      const match = (raw || "").trim().match(/^(\d{1,2})(\d{2})$/);
      return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
    };
    const cleanCustomerName = (raw: string | null | undefined) =>
      (raw || "").replace(/\s*様\s*$/, "").replace(/\s*さん\s*$/, "").trim() || null;
    const findDetailHref = (raw: string) => {
      const direct = raw.match(/https?:\/\/[^'"\s<>]+(?:reserve\/)?(?:net\/reserveDetail|ext\/extReserveDetail|reserveDetail)\/?\?reserveId=[A-Z0-9]+/i);
      if (direct?.[0]) return direct[0].replace(/&amp;/g, "&");
      const relative = raw.match(/(?:\/CLP\/bt\/)?(?:reserve\/)?(?:net\/reserveDetail|ext\/extReserveDetail|reserveDetail)\/?\?reserveId=[A-Z0-9]+/i);
      if (relative?.[0]) {
        try { return new URL(relative[0].replace(/&amp;/g, "&"), location.href).href; } catch (_) { return relative[0].replace(/&amp;/g, "&"); }
      }
      return null;
    };
    const chooseTarget = (el: HTMLElement) => {
      const parents: HTMLElement[] = [];
      let cur: HTMLElement | null = el;
      for (let i = 0; i < 7 && cur; i++) {
        parents.push(cur);
        cur = cur.parentElement;
      }
      for (const p of parents) {
        const rect = p.getBoundingClientRect();
        const cls = (p.className || "").toString().toLowerCase();
        const raw = `${p.getAttribute("href") || ""} ${p.getAttribute("onclick") || ""}`;
        const hasAction = !!raw.trim() || /schedule|reserve|appoint|panel|item|box|sch_|reserved/.test(cls);
        if (hasAction && rect.width >= 20 && rect.height >= 10) return p;
      }
      return el;
    };
    const rawFor = (el: HTMLElement) => {
      const attrs = [
        el.getAttribute("href"),
        el.getAttribute("onclick"),
        el.getAttribute("value"),
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("data-reserve-id"),
        el.getAttribute("data-reserveid"),
      ].filter(Boolean).join(" ");
      const html = (el.outerHTML || "").slice(0, 2500);
      const parentHtml = (el.parentElement?.outerHTML || "").slice(0, 2500);
      return `${attrs} ${html} ${parentHtml}`;
    };
    const add = (el: HTMLElement, source: string, reserveIdOverride?: string | null, detailHrefOverride?: string | null) => {
      const target = chooseTarget(el);
      const raw = rawFor(target);
      const reserveId = reserveIdOverride || findReserveId(raw);
      const detailHref = detailHrefOverride || findDetailHref(raw);
      const text = short(target.innerText || el.innerText || el.textContent || "");
      const snippet = short(text || raw, 260);
      if (!reserveId && !detailHref && !text) return;
      const key = reserveId ? `id:${reserveId}` : `el:${idx}:${snippet}`;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.detailHref ||= detailHref;
        if (!existing.source.includes(source)) existing.source = `${existing.source},${source}`;
        return;
      }
      const attr = "data-sb-list-idx";
      target.setAttribute(attr, String(idx));
      candidateMap.set(key, {
        idx,
        text,
        snippet,
        reserveId,
        detailHref,
        source,
        element: target,
      });
      idx += 1;
    };

    for (const panel of Array.from(document.querySelectorAll("div.panel_reserve, [id^='reserve_item_BF'], .panel_reserve_id")) as HTMLElement[]) {
      const root =
        (panel.classList?.contains("panel_reserve") ? panel : null) ||
        (panel.closest("div.panel_reserve, [id^='reserve_item_BF']") as HTMLElement | null) ||
        panel;
      const textOf = (selector: string) => {
        const el = root.querySelector(selector) as HTMLElement | HTMLInputElement | null;
        if (!el) return "";
        if ("value" in el && el.value) return normalize(el.value);
        return normalize(el.textContent || (el as HTMLElement).innerText || "");
      };
      const rootRaw = rawFor(root);
      const reserveId = textOf(".panel_reserve_id") ||
        (root.getAttribute("id") || "").match(/reserve_item_([A-Z0-9]+)/i)?.[1]?.toUpperCase() ||
        findReserveId(rootRaw);
      if (!reserveId) continue;
      const panelDate = textOf(".panel_reserve_date");
      const startRaw = textOf(".panel_reserve_start");
      const customerName = cleanCustomerName(textOf(".reserveItemCustomer"));
      const stylistId = textOf(".panel_reserve_stylistId");
      const panelUpdate = textOf(".panel_reserve_update");
      const reserveType = textOf(".panel_reserve_reserveTypeFlg");
      const detailHref = findDetailHref(rootRaw) ||
        `https://salonboard.com/CLP/bt/reserve/net/reserveDetail/?reserveId=${encodeURIComponent(reserveId)}`;
      const key = `id:${reserveId}`;
      const existing = candidateMap.get(key);
      const candidate = {
        idx,
        text: short(root.innerText || root.textContent || `${customerName || ""} ${startRaw}`),
        snippet: short(root.innerText || root.textContent || rootRaw, 260),
        reserveId,
        detailHref,
        source: "panel_reserve",
        time: compactClock(startRaw),
        panelDate: /^\d{8}$/.test(panelDate) ? panelDate : null,
        customerName,
        stylistId: stylistId || null,
        panelUpdate: panelUpdate || null,
        reserveType: reserveType || null,
        element: root,
      };
      if (existing) {
        existing.detailHref ||= candidate.detailHref;
        existing.time ||= candidate.time;
        existing.panelDate ||= candidate.panelDate;
        existing.customerName ||= candidate.customerName;
        existing.stylistId ||= candidate.stylistId;
        existing.panelUpdate ||= candidate.panelUpdate;
        existing.reserveType ||= candidate.reserveType;
        if (!existing.source.includes("panel_reserve")) existing.source = `${existing.source},panel_reserve`;
        continue;
      }
      root.setAttribute("data-sb-list-idx", String(idx));
      candidateMap.set(key, candidate);
      idx += 1;
    }

    for (const el of all) {
      const own = normalize(el.innerText || el.textContent || "");
      if (!own) continue;
      if (!/\u69d8(?:\s|$|\uff08|\()/.test(own)) continue;
      if (ACTION_TEXTS.has(own)) continue;
      const innermost = !Array.from(el.querySelectorAll("*")).some((child) =>
        /\u69d8(?:\s|$|\uff08|\()/.test(normalize((child as HTMLElement).innerText || child.textContent || "")));
      if (innermost) add(el, "honorific_text");
    }

    for (const el of all) {
      const raw = rawFor(el);
      if (!/(reserveId|rsvId|reserve_id|reservationId|reserveNo|reserveDetail|extReserveDetail|BF\d{6,})/i.test(raw)) {
        continue;
      }
      add(el, "reserve_id_dom", findReserveId(raw), findDetailHref(raw));
    }

    return Array.from(candidateMap.values())
      .sort((a, b) => a.idx - b.idx)
      .slice(0, 160)
      .map(({ element: _element, ...candidate }) => candidate);
  }).catch((e: unknown) => {
    logger.warn({ e: e instanceof Error ? e.message : String(e) }, "listDayReservations: candidate eval failed");
    return [] as Candidate[];
  });

  diagnostics.detected_count = candidates.length;
  diagnostics.panel_reserve_detected_count = candidates.filter((cand) => cand.source.includes("panel_reserve")).length;
  diagnostics.schedule_detected_count = candidates.length;
  logger.info({ candidateCount: candidates.length }, "listDayReservations: candidates found");

  const results: DayReservation[] = [];
  const resultMap = new Map<string, DayReservation>();

  for (const cand of candidates) {
    try {
      const sel = `[data-sb-list-idx="${cand.idx}"]`;
      const hasClickTarget = (await page.locator(sel).count()) > 0;
      if (!hasClickTarget) {
        if (cand.reserveId || cand.detailHref) {
          const added = addResult(results, resultMap, buildFallbackItem(date, cand, "click_target_missing"));
          diagnostics.fallback_used_count += 1;
          if (!added.inserted) diagnostics.deduped_count += 1;
        } else {
          addDiagnostic(diagnostics.skipped_candidates, {
            reserveId: cand.reserveId,
            reason: "click_target_missing",
            source: cand.source,
            snippet: cand.snippet || cand.text,
            stage: "candidate_extract",
          });
        }
        continue;
      }

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(120);

      const target = page.locator(sel).first();
      await target.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      await target.click({ force: true, timeout: 2500 }).catch(() => {});

      const popupAppeared = await page
        .waitForSelector("#reserveItemName, .reserveCustomerName", { timeout: 2500, state: "visible" })
        .then(() => true).catch(() => false);
      if (!popupAppeared) {
        if (cand.reserveId || cand.detailHref) {
          const added = addResult(results, resultMap, buildFallbackItem(date, cand, "popup_not_found"));
          diagnostics.fallback_used_count += 1;
          if (!added.inserted) diagnostics.deduped_count += 1;
        } else {
          addDiagnostic(diagnostics.skipped_candidates, {
            reserveId: cand.reserveId,
            reason: "popup_not_found",
            source: cand.source,
            snippet: cand.snippet || cand.text,
            stage: "popup_parse",
          });
        }
        continue;
      }

      const popupData = await page.evaluate(() => {
        const normalize = (value: string | null | undefined) =>
          (value || "").replace(/\s+/g, " ").trim();
        const findReserveId = (raw: string) => {
          const idByName = raw.match(/(?:reserveId|rsvId|reserve_id|reservationId|reserveNo)["'=:\s]*([A-Z0-9]{8,})/i);
          if (idByName?.[1]) return idByName[1].toUpperCase();
          const bf = raw.match(/\bBF\d{6,}\b/i);
          if (bf?.[0]) return bf[0].toUpperCase();
          const generic = raw.match(/\b[A-Z]{2}\d{6,}\b/i);
          return generic?.[0]?.toUpperCase() || null;
        };
        const findDetailHref = (raw: string) => {
          const direct = raw.match(/https?:\/\/[^'"\s<>]+(?:reserve\/)?(?:net\/reserveDetail|ext\/extReserveDetail|reserveDetail)\/?\?reserveId=[A-Z0-9]+/i);
          if (direct?.[0]) return direct[0].replace(/&amp;/g, "&");
          const relative = raw.match(/(?:\/CLP\/bt\/)?(?:reserve\/)?(?:net\/reserveDetail|ext\/extReserveDetail|reserveDetail)\/?\?reserveId=[A-Z0-9]+/i);
          if (relative?.[0]) {
            try { return new URL(relative[0].replace(/&amp;/g, "&"), location.href).href; } catch (_) { return relative[0].replace(/&amp;/g, "&"); }
          }
          return null;
        };
        const q = (s: string) => document.querySelector(s);
        const txt = (s: string) => {
          const el = q(s) as HTMLElement | null;
          return el ? normalize(el.innerText || el.textContent || "") : "";
        };
        const reserveCustomerName = txt(".reserveCustomerName") || txt("#reserveItemName");
        const popupRoot =
          (q("#reserveItemName")?.closest(".mod_column02, .mod_box_01, .modalContents, .pop, [class*='popup' i]") as HTMLElement | null) ||
          (q(".reserveCustomerName")?.closest(".mod_column02, .mod_box_01, .modalContents, .pop, [class*='popup' i]") as HTMLElement | null) ||
          document.body;
        const popupText = normalize(popupRoot.innerText || "");
        const raw = Array.from(popupRoot.querySelectorAll("a, button, [onclick], input"))
          .map((el) => `${(el as HTMLAnchorElement).href || ""} ${el.getAttribute("href") || ""} ${el.getAttribute("onclick") || ""} ${el.getAttribute("value") || ""}`)
          .join(" ") + ` ${popupRoot.outerHTML || ""}`;
        return {
          reserveCustomerName,
          popupText: popupText.slice(0, 1000),
          extractedReserveId: findReserveId(`${popupText} ${raw}`),
          detailHref: findDetailHref(raw),
        };
      }).catch(() => null);

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(80);

      const reserveId = popupData?.extractedReserveId || cand.reserveId || null;
      const detailHref = popupData?.detailHref || cand.detailHref || (reserveId ? fallbackDetailUrl(reserveId) : null);
      const popupText = popupData?.popupText || cand.text || "";
      const customerName = cand.customerName || parseCustomerName(popupData?.reserveCustomerName || popupText);
      const time = cand.time || parseClock(popupText || cand.text);

      if (!popupData?.reserveCustomerName && !reserveId && !detailHref) {
        addDiagnostic(diagnostics.skipped_candidates, {
          reserveId,
          reason: "popup_customer_missing",
          source: cand.source,
          snippet: popupText || cand.snippet || cand.text,
          stage: "popup_parse",
        });
        continue;
      }

      const added = addResult(results, resultMap, {
        external_reservation_id: reserveId,
        date,
        time,
        customerName,
        menu: null,
        stylistName: null,
        raw: clip(popupText || cand.text, 300),
        detail_href: detailHref,
        time_source: time ? "popup" : null,
        stylist_id: cand.stylistId || null,
        panel_update: cand.panelUpdate || null,
        reserve_type: cand.reserveType || null,
        raw_payload: {
          candidate_source: cand.source,
          candidate_snippet: clip(cand.snippet, 500),
          panel_date: cand.panelDate || null,
          panel_start_time: cand.time || null,
          panel_stylist_id: cand.stylistId || null,
          panel_update: cand.panelUpdate || null,
          panel_reserve_type: cand.reserveType || null,
        },
      });
      const item = added.item;
      if (!added.inserted) diagnostics.deduped_count += 1;

      if (cand.source.includes("panel_reserve")) addWarning(item, "panel_reserve_direct");
      if (!popupData?.reserveCustomerName) addWarning(item, "popup_customer_missing");
      if (!time) addWarning(item, "time_missing_from_popup");
    } catch (e) {
      addDiagnostic(diagnostics.failed_candidates, {
        reserveId: cand.reserveId,
        reason: e instanceof Error ? e.message : String(e),
        source: cand.source,
        snippet: cand.snippet || cand.text,
        stage: "popup_parse",
      });
      logger.warn({ idx: cand.idx, e: e instanceof Error ? e.message : String(e) }, "listDayReservations: cand failed");
    }
  }

  const reservationListCandidates = await collectReservationListCandidates(page, date, diagnostics);
  diagnostics.reservation_list_detected_count = reservationListCandidates.length;
  diagnostics.detected_count = diagnostics.schedule_detected_count + diagnostics.reservation_list_detected_count;
  for (const cand of reservationListCandidates) {
    const item = buildFallbackItem(date, cand, "reservation_list_fallback");
    if (!item.time) addWarning(item, "schedule_not_found");
    if (item.status && item.status.includes("\u53d7\u4ed8\u5f85\u3061")) addWarning(item, "waiting_status");
    if (item.stylistName?.includes("\u62c5\u5f53\u672a\u5b9a") || item.stylistName?.includes("\u30d5\u30ea\u30fc\u4e88\u7d04")) {
      addWarning(item, "unassigned_staff");
    }
    const added = addResult(results, resultMap, item);
    diagnostics.fallback_used_count += 1;
    if (!added.inserted) diagnostics.deduped_count += 1;
  }

  let detailFetched = 0;
  for (const r of results) {
    const href = r.detail_href || (r.external_reservation_id ? fallbackDetailUrl(r.external_reservation_id) : "");
    if (!href || !isDetailHref(href)) continue;
    if (detailFetched >= DETAIL_FETCH_DAILY_LIMIT) {
      r.time_source = r.time_source || "not_fetched_limit";
      r.detail_fetch_skipped_reason = "daily_detail_fetch_limit";
      diagnostics.detail_fetch_limited_count += 1;
      addWarning(r, "detail_fetch_limited");
      continue;
    }
    detailFetched += 1;
    const detailUrl = resolveSalonboardUrl(href);
    r.detail_url = detailUrl;
    try {
      await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      if (/\/login/i.test(page.url())) {
        r.detail_fetch_error = "session_expired";
        addDiagnostic(diagnostics.failed_candidates, {
          reserveId: r.external_reservation_id,
          reason: "session_expired",
          source: "detail",
          snippet: detailUrl,
          stage: "detail_fetch",
        });
        break;
      }
      const body = await page.locator("body").innerText().catch(() => "");
      if (/\u753b\u50cf\u8a8d\u8a3c|\u30ad\u30e3\u30d7\u30c1\u30e3|captcha|reCAPTCHA/i.test(body)) {
        r.detail_fetch_error = "captcha_required";
        addDiagnostic(diagnostics.failed_candidates, {
          reserveId: r.external_reservation_id,
          reason: "captcha_required",
          source: "detail",
          snippet: detailUrl,
          stage: "detail_fetch",
        });
        break;
      }

      const detailData = await page.evaluate(() => {
        const labels = {
          reservationNo: "\u4e88\u7d04\u756a\u53f7",
          status: "\u30b9\u30c6\u30fc\u30bf\u30b9",
          route: "\u4e88\u7d04\u7d4c\u8def",
          stylist: "\u30b9\u30bf\u30a4\u30ea\u30b9\u30c8",
          menu: "\u30e1\u30cb\u30e5\u30fc",
          coupon: "\u30af\u30fc\u30dd\u30f3",
          customerKanji: "\u6c0f\u540d\uff08\u6f22\u5b57\uff09",
          customer: "\u6c0f\u540d",
          phone: "\u96fb\u8a71\u756a\u53f7",
          gender: "\u6027\u5225",
          visitDate: "\u6765\u5e97\u65e5\u6642",
          payment: "\u304a\u652f\u6255\u3044",
        };
        const normalize = (value: string | null | undefined) =>
          (value || "").replace(/\s+/g, " ").trim();
        const findByLabel = (label: string) => {
          for (const row of Array.from(document.querySelectorAll("tr"))) {
            const cells = Array.from(row.querySelectorAll("th, td")) as HTMLElement[];
            for (let i = 0; i < cells.length; i++) {
              const text = normalize(cells[i].innerText || cells[i].textContent || "");
              if (!text.includes(label)) continue;
              const next = cells[i + 1];
              if (next) return normalize(next.innerText || next.textContent || "");
              const withoutLabel = normalize(row.textContent || "").replace(text, "").trim();
              if (withoutLabel) return withoutLabel;
            }
          }
          for (const el of Array.from(document.querySelectorAll("dt, th, .label, [class*='label' i]")) as HTMLElement[]) {
            const text = normalize(el.innerText || el.textContent || "");
            if (!text.includes(label)) continue;
            const next = el.nextElementSibling as HTMLElement | null;
            if (next) return normalize(next.innerText || next.textContent || "");
          }
          return "";
        };
        const fullText = normalize(document.body?.innerText || "");
        const rsvDateText = normalize((document.querySelector("#rsvDate") as HTMLElement | null)?.innerText || "") ||
          findByLabel(labels.visitDate);
        const reserveId = findByLabel(labels.reservationNo) ||
          (fullText.match(/\bBF\d{6,}\b/i)?.[0] || "");
        return {
          reserveId,
          status: findByLabel(labels.status),
          route: findByLabel(labels.route),
          stylist: findByLabel(labels.stylist),
          menu: findByLabel(labels.menu),
          coupon: findByLabel(labels.coupon),
          customerName: findByLabel(labels.customerKanji) || findByLabel(labels.customer),
          phone: findByLabel(labels.phone),
          gender: findByLabel(labels.gender),
          payment: findByLabel(labels.payment),
          rsvDateText,
          fullText: fullText.slice(0, 1500),
        };
      });

      const timeSourceText = `${detailData.rsvDateText || ""} ${detailData.fullText || ""}`;
      const parsed = parseTimeRangeAndDuration(timeSourceText);
      if (parsed.start) {
        r.time = parsed.start;
        r.end_time = parsed.end;
        r.duration_minutes = parsed.duration;
        r.time_source = "detail";
      } else {
        r.detail_fetch_error ||= "time_range_not_found";
        addWarning(r, "detail_time_range_not_found");
        addDiagnostic(diagnostics.failed_candidates, {
          reserveId: r.external_reservation_id,
          reason: "time_range_not_found",
          source: "detail",
          snippet: timeSourceText,
          stage: "detail_parse",
        });
      }

      r.external_reservation_id ||= extractReserveId(detailData.reserveId);
      r.status ||= detailData.status || null;
      r.route ||= detailData.route || null;
      r.source ||= detailData.route || null;
      r.stylistName ||= detailData.stylist || null;
      r.menu ||= detailData.menu || null;
      r.coupon_name ||= detailData.coupon || null;
      r.customerName ||= detailData.customerName || null;
      r.payment_type ||= detailData.payment || null;
      r.raw_payload = {
        ...(r.raw_payload || {}),
        detail: {
          url: detailUrl,
          reserveId: detailData.reserveId || null,
          status: detailData.status || null,
          route: detailData.route || null,
          stylist: detailData.stylist || null,
          menu: detailData.menu || null,
          coupon: detailData.coupon || null,
          customerName: detailData.customerName || null,
          phone_present: !!detailData.phone,
          gender: detailData.gender || null,
          payment: detailData.payment || null,
          rsvDateText: detailData.rsvDateText || null,
        },
      };
    } catch (e) {
      r.detail_fetch_error = "detail_fetch_error";
      addWarning(r, "detail_fetch_error");
      addDiagnostic(diagnostics.failed_candidates, {
        reserveId: r.external_reservation_id,
        reason: e instanceof Error ? e.message : String(e),
        source: "detail",
        snippet: detailUrl,
        stage: "detail_fetch",
      });
      logger.warn({ href, e: e instanceof Error ? e.message : String(e) }, "listDayReservations: detail fetch failed");
    }
    await page.waitForTimeout(500);
  }

  diagnostics.parsed_count = results.length;
  diagnostics.skipped_count = diagnostics.skipped_candidates.length;
  diagnostics.failed_count = diagnostics.failed_candidates.length;
  logger.info({ count: results.length, detailFetched, diagnostics }, "listDayReservations: done");
  return { items: results, diagnostics };
}
