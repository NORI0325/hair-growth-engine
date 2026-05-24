// 第3段階: 「サロンボードから取り込み」
// 外部にだけ存在する予約 (external_only / local_missing) を SalonBoost 側に取り込む。
// 安全策: location_id 必須 / external_reservation_id 重複チェック / 情報不足は needs_manual_review。
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
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const {
      location_id,
      external_reservation_id,
      booking_date,
      booking_time, // "HH:MM"
      customer_name,
      customer_phone,
      menu, // optional
      duration_minutes, // optional
      end_time, // optional
    } = body ?? {};

    if (!location_id) return new Response(JSON.stringify({ error: "location_required", message: "location_id は必須です" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!booking_date || !booking_time) return new Response(JSON.stringify({ error: "datetime_required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!external_reservation_id) return new Response(JSON.stringify({ error: "external_reservation_id_required", message: "external_reservation_id が無い予約は取り込めません" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 重複チェック
    const { data: dup } = await supabase.from("bookings")
      .select("id").eq("owner_id", user.id).eq("external_reservation_id", external_reservation_id).maybeSingle();
    if (dup) {
      return new Response(JSON.stringify({ action: "skipped", reason: "already_imported", booking_id: dup.id, message: "この external_reservation_id は既に取り込み済みです。" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 顧客は名寄せできない場合があるため、暫定: 名前一致 or プレースホルダー
    let customerId: string | null = null;
    if (customer_name) {
      const { data: cust } = await supabase.from("customers")
        .select("id").eq("owner_id", user.id).eq("full_name", customer_name).maybeSingle();
      customerId = cust?.id ?? null;
    }
    if (!customerId) {
      // 名寄せ未確定: needs_manual_review で「不明顧客」を作成しない方針 — 仮顧客を1件作る
      const { data: newCust } = await supabase.from("customers").insert({
        owner_id: user.id, location_id,
        full_name: customer_name || "（取り込み・要確認）",
        phone: customer_phone ?? null,
      }).select("id").maybeSingle();
      customerId = newCust?.id ?? null;
    }
    if (!customerId) return new Response(JSON.stringify({ error: "customer_create_failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const durationFromDetail = durationFromTimes(booking_time, end_time);
    const resolvedDuration = durationFromDetail ?? (
      Number.isFinite(Number(duration_minutes)) && Number(duration_minutes) > 0
        ? Number(duration_minutes)
        : null
    );
    const durationNeedsReview = !resolvedDuration;
    const needsReview = !menu || !customer_name || durationNeedsReview;
    const reviewNotes = durationNeedsReview
      ? "サロンボード予約の施術時間未取得。実予約の終了時刻を確認してください。"
      : null;

    const { data: ins, error: insErr } = await supabase.from("bookings").insert({
      owner_id: user.id,
      location_id,
      customer_id: customerId,
      booking_date,
      booking_time,
      menu: menu || "（取り込み・要確認）",
      total_duration_minutes: resolvedDuration,
      notes: reviewNotes,
      status: "confirmed",
      external_reservation_id,
      external_source: "salonboard_import",
      source_channel: "salonboard",
      sync_status: needsReview ? "needs_review" : "success",
      needs_manual_review: needsReview,
      last_synced_at: new Date().toISOString(),
    }).select("id").maybeSingle();

    if (insErr) return new Response(JSON.stringify({ error: "booking_insert_failed", message: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({
      action: "imported", booking_id: ins!.id,
      needs_manual_review: needsReview,
      message: needsReview
        ? "取り込みました。メニュー / 顧客名が不足しているため要確認状態です。"
        : "取り込みました。",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
