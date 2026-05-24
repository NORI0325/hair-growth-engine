// Scheduled dry-run dispatcher for Salonboard reservation mirroring.
// It only invokes salonboard-fetch-reservations-range with mode=dry_run.
// It does not insert bookings, create sync_jobs, or send data back to Salonboard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

type Slot = "morning" | "noon" | "evening";

const VALID_SLOTS = new Set(["morning", "noon", "evening"]);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getJstHour = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
};

const resolveSlot = (value: unknown): Slot | null => {
  if (typeof value === "string" && VALID_SLOTS.has(value)) return value as Slot;
  const hour = getJstHour();
  if (hour === 9) return "morning";
  if (hour === 13) return "noon";
  if (hour === 18) return "evening";
  return null;
};

const clampLimit = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
};

const isAuthorized = (req: Request) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (serviceKey && token === serviceKey) return true;

  const configuredSecret =
    Deno.env.get("SALONBOARD_RESERVATION_SYNC_CRON_SECRET") ||
    Deno.env.get("CRON_SECRET") ||
    "";
  const providedSecret =
    req.headers.get("x-cron-secret") ||
    req.headers.get("x-scheduler-secret") ||
    "";
  return !!configuredSecret && providedSecret === configuredSecret;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);
  if (!isAuthorized(req)) return json({ success: false, error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({ success: false, error: "supabase_not_configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({}));
  const slot = resolveSlot(body.slot);
  if (!slot) {
    return json({
      success: true,
      skipped: true,
      error: "outside_schedule_window",
      message: "No scheduled Salonboard reservation dry_run slot for the current JST hour.",
      jst_hour: getJstHour(),
    });
  }

  const maxLocations = clampLimit(body.max_locations);
  let query = supabase
    .from("channel_integrations")
    .select("owner_id, location_id")
    .eq("channel", "salonboard")
    .eq("enabled", true)
    .eq("sync_enabled", true)
    .eq("connection_status", "live")
    .not("location_id", "is", null)
    .order("owner_id", { ascending: true })
    .limit(maxLocations);

  if (typeof body.owner_id === "string" && body.owner_id) {
    query = query.eq("owner_id", body.owner_id);
  }
  if (typeof body.location_id === "string" && body.location_id) {
    query = query.eq("location_id", body.location_id);
  }

  const { data: integrations, error } = await query;
  if (error) return json({ success: false, error: "integration_fetch_failed", message: error.message }, 500);

  const targets = ((integrations as Array<{ owner_id: string; location_id: string | null }>) ?? [])
    .filter((row) => row.owner_id && row.location_id);
  const results: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/salonboard-fetch-reservations-range`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          owner_id: target.owner_id,
          location_id: target.location_id,
          run_type: "scheduled",
          slot,
          mode: "dry_run",
        }),
      });
      const payload = await response.json().catch(() => ({ success: false, error: "invalid_json" }));
      results.push({
        owner_id: target.owner_id,
        location_id: target.location_id,
        ok: response.ok && payload?.success === true,
        status: response.status,
        latency_ms: Date.now() - startedAt,
        run_id: payload?.run_id ?? null,
        error: payload?.error ?? null,
        skipped: payload?.skipped === true,
        needs_review_count: payload?.needs_review_count ?? null,
        fetched_count: payload?.fetched_count ?? null,
      });
    } catch (err) {
      results.push({
        owner_id: target.owner_id,
        location_id: target.location_id,
        ok: false,
        latency_ms: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const successCount = results.filter((result) => result.ok === true).length;
  const skippedCount = results.filter((result) => result.skipped === true).length;
  return json({
    success: true,
    dry_run: true,
    slot,
    target_count: targets.length,
    success_count: successCount,
    skipped_count: skippedCount,
    failed_count: results.length - successCount - skippedCount,
    results,
  });
});
