// サロンボード側にだけ存在する手動入力予約を SalonBoost に取り込む。
// status='confirmed', external_source='salonboard_manual', source_channel='salonboard', sync_status='success'
// 同じ external_reservation_id が既にある場合は新規作成せず skip。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const parseTimeToMinutes = (value?: string | null): number | null => {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const durationFromTimes = (start?: string | null, end?: string | null): number | null => {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  const duration = endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : endMinutes + 24 * 60 - startMinutes;
  return duration > 0 ? duration : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const {
      date, time, customer_name, menu, external_reservation_id,
      location_id, duration_minutes, end_time,
    }: {
      date?: string; time?: string; customer_name?: string;
      menu?: string | null; external_reservation_id?: string | null;
      location_id?: string | null; duration_minutes?: number | null; end_time?: string | null;
    } = body || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: "invalid_date" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
      return new Response(JSON.stringify({ error: "invalid_time" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!customer_name) {
      return new Response(JSON.stringify({ error: "customer_name_required" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 重複防止: 同じ external_reservation_id が既にある場合は skip
    if (external_reservation_id) {
      const { data: existing } = await supabase
        .from("bookings")
        .select("id, customer_id")
        .eq("owner_id", user.id)
        .eq("external_reservation_id", external_reservation_id)
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({
          success: true, action: "skipped", booking_id: existing.id,
          message: "同じ external_reservation_id が既に存在します",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 顧客解決: 名前で完全一致 → なければ作成
    let customerId: string | null = null;
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("owner_id", user.id)
      .eq("full_name", customer_name)
      .limit(1)
      .maybeSingle();
    if (cust) {
      customerId = cust.id;
    } else {
      const { data: created, error: cErr } = await supabase
        .from("customers")
        .insert({ owner_id: user.id, full_name: customer_name })
        .select("id")
        .maybeSingle();
      if (cErr || !created) {
        return new Response(JSON.stringify({ error: "customer_create_failed", message: cErr?.message }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      customerId = created.id;
    }

    const durationFromDetail = durationFromTimes(time, end_time);
    const resolvedDuration = durationFromDetail ?? (
      Number.isFinite(Number(duration_minutes)) && Number(duration_minutes) > 0
        ? Number(duration_minutes)
        : null
    );
    const durationNeedsReview = !resolvedDuration;
    const notes = durationNeedsReview
      ? "サロンボード予約の施術時間未取得。実予約の終了時刻を確認してください。"
      : null;

    const insertPayload: Record<string, unknown> = {
      owner_id: user.id,
      location_id: location_id ?? null,
      customer_id: customerId,
      booking_date: date,
      booking_time: `${time}:00`,
      menu: menu || "(サロンボード手動入力)",
      status: "confirmed",
      external_source: "salonboard_manual",
      source_channel: "salonboard",
      sync_status: durationNeedsReview ? "needs_review" : "success",
      needs_manual_review: durationNeedsReview,
      external_reservation_id: external_reservation_id ?? null,
      total_duration_minutes: resolvedDuration,
      notes,
      last_synced_at: new Date().toISOString(),
    };

    const { data: ins, error: iErr } = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select("id")
      .maybeSingle();

    if (iErr || !ins) {
      return new Response(JSON.stringify({ error: "booking_create_failed", message: iErr?.message }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true, action: "created", booking_id: ins.id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
