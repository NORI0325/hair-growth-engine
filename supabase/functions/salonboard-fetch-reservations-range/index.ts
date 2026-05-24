// Range dry-run orchestration for Salonboard reservation mirroring.
// Phase 1-2 only: reads Salonboard, compares with local bookings, and stores run summaries.
// It intentionally does not insert bookings and does not create sync_jobs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

type RunType = "manual" | "scheduled";
type Slot = "morning" | "noon" | "evening" | "manual";
type Mode = "dry_run" | "import";
type Classification = "matched" | "matched_with_diff" | "salonboard_only" | "conflict";

type ExternalItem = {
  external_reservation_id: string | null;
  date: string;
  time: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  customerName: string | null;
  menu: string | null;
  stylistName: string | null;
  raw?: string;
  detail_url?: string | null;
  time_source?: "popup" | "detail" | "not_fetched_limit" | null;
  detail_fetch_skipped_reason?: string | null;
  detail_fetch_error?: string | null;
};

type DaySummary = {
  date: string;
  total_external: number;
  total_local: number;
  matched_count: number;
  matched_with_diff_count: number;
  salonboard_only_count: number;
  local_only_count: number;
  conflict_count: number;
  needs_review_count: number;
  items: Array<ExternalItem & {
    classification: Classification;
    matched_booking_id?: string | null;
    reason?: string;
    diffs?: string[];
  }>;
};

const MAX_RANGE_DAYS = 15;
const STALE_RUNNING_MINUTES = 60;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const CRITICAL_ERROR_TYPES = new Set([
  "captcha_required",
  "login_failed",
  "external_site_changed",
  "timeout",
  "session_expired",
  "session_expired_in_list",
]);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalize = (value: string | null | undefined) =>
  (value || "").replace(/[\s　]/g, "").toLowerCase();

const formatWorkerDate = (date: string) => date.replaceAll("-", "");

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const getJstToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const enumerateDates = (start: string, end: string) => {
  const dates: string[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    dates.push(current);
    if (dates.length > MAX_RANGE_DAYS) break;
  }
  return dates;
};

const resolveScheduledRange = (slot: Slot) => {
  const today = getJstToday();
  if (slot === "morning" || slot === "noon") {
    return { range_start: today, range_end: addDays(today, 1) };
  }
  if (slot === "evening") {
    return { range_start: today, range_end: addDays(today, 14) };
  }
  return { range_start: today, range_end: today };
};

const getAuthorizedCaller = async (req: Request, ownerId: string) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const isServiceRole = !!serviceKey && token === serviceKey;
  if (isServiceRole) return { ok: true, caller: "service_role" as const };

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return { ok: false, status: 401, error: "unauthorized" };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
  );
  const { data: isMember, error } = await supabase.rpc("is_tenant_member", {
    _tenant_id: ownerId,
    _user_id: user.id,
  });
  if (error) return { ok: false, status: 500, error: "authorization_check_failed", message: error.message };
  if (!isMember) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, caller: "user" as const, userId: user.id };
};

const classifyDay = async (
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  locationId: string | null,
  date: string,
  externalItems: ExternalItem[],
): Promise<DaySummary> => {
  let localQuery = supabase
    .from("bookings")
    .select(`id, booking_date, booking_time, menu, status, external_reservation_id, external_source, customer_id,
             customers:customer_id(full_name, phone)`)
    .eq("owner_id", ownerId)
    .eq("booking_date", date);
  if (locationId) localQuery = localQuery.eq("location_id", locationId);
  const { data: localBookings, error: localError } = await localQuery;
  if (localError) throw new Error(`local_bookings_fetch_failed: ${localError.message}`);

  const local = (localBookings as any[]) ?? [];
  const usedLocalIds = new Set<string>();
  const classified = externalItems.map((item) => {
    const byExternalId = item.external_reservation_id
      ? local.find((booking) => booking.external_reservation_id === item.external_reservation_id)
      : null;

    if (byExternalId) {
      usedLocalIds.add(byExternalId.id);
      const localTime = (byExternalId.booking_time || "").slice(0, 5) || null;
      const localName = byExternalId.customers?.full_name ?? null;
      const diffs: string[] = [];
      if (item.time && localTime && item.time !== localTime) diffs.push("time");
      if (!item.time && localTime) diffs.push("time_unknown");
      const wantName = normalize(item.customerName);
      const haveName = normalize(localName);
      if (wantName && haveName && !haveName.includes(wantName) && !wantName.includes(haveName)) diffs.push("customer");
      return {
        ...item,
        classification: diffs.length > 0 ? "matched_with_diff" : "matched",
        matched_booking_id: byExternalId.id,
        reason: diffs.length > 0 ? `external_reservation_id match with diffs: ${diffs.join(",")}` : "external_reservation_id matched",
        diffs,
      };
    }

    const wantTime = item.time || "";
    const wantName = normalize(item.customerName);
    const candidates = local.filter((booking) => {
      if (usedLocalIds.has(booking.id)) return false;
      const localTime = (booking.booking_time || "").slice(0, 5);
      const localName = normalize(booking.customers?.full_name);
      const timeOk = !wantTime || !localTime || localTime === wantTime;
      const nameOk = !wantName || !localName || localName.includes(wantName) || wantName.includes(localName);
      return timeOk && nameOk;
    });

    if (candidates.length === 1) {
      const matched = candidates[0];
      usedLocalIds.add(matched.id);
      const diffs: string[] = [];
      if (!item.time && matched.booking_time) diffs.push("time_unknown");
      return {
        ...item,
        classification: diffs.length > 0 ? "matched_with_diff" : "matched",
        matched_booking_id: matched.id,
        reason: diffs.length > 0 ? `single fuzzy candidate with diffs: ${diffs.join(",")}` : "single fuzzy candidate matched",
        diffs,
      };
    }

    if (candidates.length > 1) {
      return {
        ...item,
        classification: "conflict",
        reason: `multiple fuzzy candidates: ${candidates.length}`,
      };
    }

    return {
      ...item,
      classification: "salonboard_only",
      reason: "not found in local bookings",
    };
  }) as DaySummary["items"];

  const matched_count = classified.filter((item) => item.classification === "matched").length;
  const matched_with_diff_count = classified.filter((item) => item.classification === "matched_with_diff").length;
  const salonboard_only_count = classified.filter((item) => item.classification === "salonboard_only").length;
  const conflict_count = classified.filter((item) => item.classification === "conflict").length;
  const local_only_count = local.filter((booking) => !usedLocalIds.has(booking.id)).length;
  const needs_review_count = matched_with_diff_count + salonboard_only_count + conflict_count + local_only_count;

  return {
    date,
    total_external: externalItems.length,
    total_local: local.length,
    matched_count,
    matched_with_diff_count,
    salonboard_only_count,
    local_only_count,
    conflict_count,
    needs_review_count,
    items: classified,
  };
};

const fetchDayFromWorker = async (
  supabase: ReturnType<typeof createClient>,
  workerUrl: string,
  workerKey: string,
  ownerId: string,
  locationId: string | null,
  date: string,
) => {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/salonboard/list-day-reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${workerKey}` },
      body: JSON.stringify({ store_id: ownerId, location_id: locationId, date: formatWorkerDate(date) }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({ success: false, error_type: "invalid_json" }));
    const latency = Date.now() - started;
    await supabase.from("worker_request_logs").insert({
      owner_id: ownerId,
      location_id: locationId,
      channel: "salonboard",
      kind: "list_day_reservations",
      request_payload: { date, range_dry_run: true },
      response_status: response.status,
      response_body: body,
      latency_ms: latency,
      success: !!body?.success,
      error_message: body?.success ? null : (body?.message || body?.error_type || `HTTP ${response.status}`),
    });
    if (!body?.success) {
      return {
        ok: false as const,
        error_type: body?.error_type || body?.error || "worker_failed",
        error_message: body?.message || `HTTP ${response.status}`,
      };
    }
    return {
      ok: true as const,
      items: Array.isArray(body.items) ? body.items as ExternalItem[] : [],
    };
  } catch (error) {
    const errorType = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "worker_failed";
    return {
      ok: false as const,
      error_type: errorType,
      error_message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let runId: string | null = null;
  let ownerId = "";
  let locationId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    ownerId = typeof body.owner_id === "string" ? body.owner_id : "";
    locationId = typeof body.location_id === "string" && body.location_id ? body.location_id : null;
    const runType: RunType = body.run_type === "scheduled" ? "scheduled" : "manual";
    const slot: Slot = ["morning", "noon", "evening", "manual"].includes(body.slot) ? body.slot : "manual";
    const mode: Mode = body.mode === "import" ? "import" : "dry_run";

    if (!ownerId) return json({ success: false, error: "owner_id_required" }, 400);
    if (mode !== "dry_run") {
      return json({ success: false, error: "import_mode_not_enabled", message: "Phase 1-2 supports dry_run only." }, 400);
    }

    const auth = await getAuthorizedCaller(req, ownerId);
    if (!auth.ok) return json({ success: false, error: auth.error, message: auth.message }, auth.status);

    const scheduledRange = resolveScheduledRange(slot);
    const rangeStart = isIsoDate(body.range_start) ? body.range_start : scheduledRange.range_start;
    const rangeEnd = isIsoDate(body.range_end) ? body.range_end : scheduledRange.range_end;
    if (rangeEnd < rangeStart) return json({ success: false, error: "invalid_range" }, 400);

    const dates = enumerateDates(rangeStart, rangeEnd);
    if (dates.length > MAX_RANGE_DAYS || dates[dates.length - 1] !== rangeEnd) {
      return json({ success: false, error: "range_too_large", message: `Maximum range is ${MAX_RANGE_DAYS} days.` }, 400);
    }

    const workerUrl = Deno.env.get("EXTERNAL_WORKER_API_URL");
    const workerKey = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    if (!workerUrl || !workerKey) {
      return json({ success: false, error: "worker_not_configured" }, 500);
    }

    const staleCutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000).toISOString();
    let staleQuery = supabase
      .from("salonboard_reservation_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_type: "lock_timeout",
        error_message: `Marked stale after ${STALE_RUNNING_MINUTES} minutes.`,
      })
      .eq("owner_id", ownerId)
      .eq("status", "running")
      .lt("started_at", staleCutoff);
    staleQuery = locationId ? staleQuery.eq("location_id", locationId) : staleQuery.is("location_id", null);
    await staleQuery;

    const { data: insertedRun, error: insertRunError } = await supabase
      .from("salonboard_reservation_sync_runs")
      .insert({
        owner_id: ownerId,
        location_id: locationId,
        run_type: runType,
        slot,
        mode,
        range_start: rangeStart,
        range_end: rangeEnd,
        status: "running",
        meta: {
          requested_by: auth.caller,
          requested_user_id: "userId" in auth ? auth.userId : null,
          timezone: "Asia/Tokyo",
          dry_run: true,
          schedule_presets: {
            morning: "today_to_tomorrow",
            noon: "today_to_tomorrow",
            evening: "today_to_today_plus_14_days",
          },
        },
      })
      .select("id")
      .maybeSingle();

    if (insertRunError || !insertedRun) {
      if (insertRunError?.code === "23505") {
        await supabase.from("salonboard_reservation_sync_runs").insert({
          owner_id: ownerId,
          location_id: locationId,
          run_type: runType,
          slot,
          mode,
          range_start: rangeStart,
          range_end: rangeEnd,
          status: "skipped",
          finished_at: new Date().toISOString(),
          error_type: "concurrent_run",
          error_message: "Another Salonboard reservation range sync is already running.",
        });
        return json({
          success: false,
          skipped: true,
          error: "concurrent_run",
          message: "Another Salonboard reservation range sync is already running.",
        }, 200);
      }
      throw new Error(`run_create_failed: ${insertRunError?.message || "unknown"}`);
    }
    runId = insertedRun.id;

    const daySummaries: DaySummary[] = [];
    for (const date of dates) {
      const fetched = await fetchDayFromWorker(supabase, workerUrl, workerKey, ownerId, locationId, date);
      if (!fetched.ok) {
        const isCritical = CRITICAL_ERROR_TYPES.has(fetched.error_type);
        throw new Error(`${isCritical ? "critical_" : ""}${fetched.error_type}: ${fetched.error_message}`);
      }
      const summary = await classifyDay(supabase, ownerId, locationId, date, fetched.items);
      daySummaries.push(summary);
    }

    const totals = daySummaries.reduce((acc, day) => {
      acc.fetched_days += 1;
      acc.fetched_count += day.total_external;
      acc.matched_count += day.matched_count;
      acc.matched_with_diff_count += day.matched_with_diff_count;
      acc.salonboard_only_count += day.salonboard_only_count;
      acc.local_only_count += day.local_only_count;
      acc.conflict_count += day.conflict_count;
      acc.needs_review_count += day.needs_review_count;
      return acc;
    }, {
      fetched_days: 0,
      fetched_count: 0,
      matched_count: 0,
      matched_with_diff_count: 0,
      salonboard_only_count: 0,
      local_only_count: 0,
      conflict_count: 0,
      needs_review_count: 0,
    });

    await supabase
      .from("salonboard_reservation_sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        ...totals,
        meta: {
          dry_run: true,
          timezone: "Asia/Tokyo",
          days: daySummaries.map((day) => ({
            date: day.date,
            total_external: day.total_external,
            total_local: day.total_local,
            matched_count: day.matched_count,
            matched_with_diff_count: day.matched_with_diff_count,
            salonboard_only_count: day.salonboard_only_count,
            local_only_count: day.local_only_count,
            conflict_count: day.conflict_count,
            needs_review_count: day.needs_review_count,
          })),
        },
      })
      .eq("id", runId);

    return json({
      success: true,
      run_id: runId,
      owner_id: ownerId,
      location_id: locationId,
      run_type: runType,
      slot,
      mode,
      range_start: rangeStart,
      range_end: rangeEnd,
      ...totals,
      days: daySummaries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorType = message.split(":")[0]?.replace(/^critical_/, "") || "internal";
    if (runId) {
      await supabase
        .from("salonboard_reservation_sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_type: errorType,
          error_message: message,
        })
        .eq("id", runId);
    }
    return json({ success: false, error: errorType, message, run_id: runId }, 200);
  }
});
