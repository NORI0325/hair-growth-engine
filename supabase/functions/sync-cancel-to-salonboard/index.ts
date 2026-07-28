// SalonBoost側で予約がキャンセルされたとき、サロンボード側にも反映する。
// 1) booking.external_reservation_id があれば cancel_reservation sync_job を作成
// 2) bookings.cancelled_source / cancelled_at を保存
// 3) sync-job-dispatch を即時呼び出してWorkerへ投げる
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { isExternalMirrorBooking, logExternalMirrorBlocked } from "../_shared/external-mirror-booking.ts";
import { authenticateRequest } from "../_shared/request-auth.ts";

function fmtDate(d: string): string { return d.replaceAll("-", ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const booking_id: string | undefined = body.booking_id;
    const no_show: boolean = !!body.no_show;
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const identity = await authenticateRequest(req, supabase);
    if (identity.kind === "anonymous") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = identity.kind === "user" ? identity.userId : null;

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, owner_id, location_id, booking_date, booking_time, status, external_reservation_id, staff_id, sync_status, customer_id, source_channel, external_source, needs_manual_review, customers(full_name)")
      .eq("id", booking_id).maybeSingle();
    if (!booking) {
      return new Response(JSON.stringify({ error: "booking_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ユーザー認可: owner本人 or テナントメンバーのみ
    if (userId && booking.owner_id !== userId) {
      const { data: ok } = await supabase.rpc("is_location_accessible", {
        _location_id: booking.location_id, _user_id: userId,
      });
      if (!ok) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (isExternalMirrorBooking(booking)) {
      const code = "EXTERNAL_MIRROR_BOOKING_CANCEL_BLOCKED";
      await logExternalMirrorBlocked(supabase, booking, "cancel", code);
      return new Response(JSON.stringify({
        ok: false,
        success: false,
        code,
        error: code,
        message: "External SalonBoard mirror bookings cannot be cancelled from SalonBoost.",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 外部IDがなければサロンボード側同期は不要
    if (!booking.external_reservation_id) {
      const { error: cancelError } = await supabase.from("bookings").update({
        status: no_show ? "no_show" : "cancelled",
        cancelled_source: "salonboost",
        cancelled_at: new Date().toISOString(),
        sync_status: "not_required",
      }).eq("id", booking.id);
      if (cancelError) {
        return new Response(JSON.stringify({ error: "booking_update_failed", message: cancelError.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        success: true, skipped: true, reason: "no_external_reservation_id",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // チャネル設定確認
    let ciq = supabase.from("channel_integrations")
      .select("enabled, sync_enabled, connection_status")
      .eq("owner_id", booking.owner_id).eq("channel", "salonboard");
    ciq = booking.location_id ? ciq.eq("location_id", booking.location_id) : ciq.is("location_id", null);
    const { data: ci } = await ciq.maybeSingle();
    if (!ci?.enabled || !ci?.sync_enabled || ci?.connection_status !== "live") {
      return new Response(JSON.stringify({
        success: false, code: "SALONBOARD_CHANNEL_NOT_LIVE", reason: "channel_not_live",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // staff → external stylistId 解決（無ければフリー扱い）
    let stylistId = "0000000000";
    if (booking.staff_id) {
      const { data: m } = await supabase.from("staff_channel_mappings")
        .select("external_id").eq("staff_id", booking.staff_id)
        .eq("owner_id", booking.owner_id)
        .eq("location_id", booking.location_id)
        .eq("channel", "salonboard").eq("enabled", true).maybeSingle();
      if (m?.external_id) stylistId = String(m.external_id);
    }

    const customerName = (booking as any).customers?.full_name ?? null;
    const timeHHMM = (booking.booking_time ?? "").slice(0, 5).replace(":", "");
    const requestPayload = {
      external_reservation_id: booking.external_reservation_id,
      date: fmtDate(booking.booking_date),
      time: timeHHMM || null,
      stylistId,
      customerName,
      noShow: no_show,
    };

    // 重複防止: 同一予約の未完了 cancel ジョブがあれば再利用
    const { data: existing } = await supabase.from("sync_jobs")
      .select("id").eq("reservation_id", booking.id)
      .eq("target_channel", "salonboard").eq("job_type", "cancel_reservation")
      .in("status", ["pending", "processing"]).maybeSingle();

    let jobId: string | null = existing?.id ?? null;
    let createdJob = false;
    if (!jobId) {
      const { data: ins, error: insErr } = await supabase.from("sync_jobs").insert({
        owner_id: booking.owner_id,
        location_id: booking.location_id,
        reservation_id: booking.id,
        target_channel: "salonboard",
        job_type: "cancel_reservation",
        status: "pending",
        request_payload: requestPayload,
      }).select("id").maybeSingle();
      if (insErr) {
        return new Response(JSON.stringify({ error: "job_insert_failed", message: insErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      jobId = ins?.id ?? null;
      createdJob = !!jobId;
    }

    const { error: cancelError } = await supabase.from("bookings").update({
      status: no_show ? "no_show" : "cancelled",
      cancelled_source: "salonboost",
      cancelled_at: new Date().toISOString(),
      sync_status: "pending",
    }).eq("id", booking.id);
    if (cancelError) {
      if (createdJob && jobId) await supabase.from("sync_jobs").delete().eq("id", jobId);
      return new Response(JSON.stringify({ error: "booking_update_failed", message: cancelError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!booking.location_id) {
      return new Response(JSON.stringify({ error: "booking_location_required" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 即時dispatch
    supabase.functions.invoke("sync-job-dispatch", {
      body: { reservation_id: booking.id, job_ids: jobId ? [jobId] : undefined },
    }).catch((e) => console.error("[sync-cancel] dispatch error:", e));

    return new Response(JSON.stringify({
      success: true, job_id: jobId, payload: requestPayload,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("sync-cancel-to-salonboard error:", e);
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
