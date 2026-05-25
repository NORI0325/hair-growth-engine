// SalonBoost側で予約の日時 / 担当 / 所要時間 が変更されたとき、
// サロンボード側にも反映する。メニュー変更は対象外（次フェーズ）。
//
// フロー:
// 1) booking と external_reservation_id を確認
// 2) external_reservation_id が無い → needs_review
// 3) staff → external stylistId 解決
// 4) update_reservation sync_job 作成（既存の pending/processing があれば再利用）
// 5) sync-job-dispatch を即時呼出
// 6) 失敗時は dispatcher 側で needs_review に落ちる
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { isExternalMirrorBooking, logExternalMirrorBlocked } from "../_shared/external-mirror-booking.ts";

function fmtDate(d: string): string { return d.replaceAll("-", ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const booking_id: string | undefined = body.booking_id;
    const internal_secret: string | undefined = body.internal_secret;
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 認可
    let authorized = false;
    let userId: string | null = null;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (internal_secret && internal_secret === serviceKey) {
      authorized = true;
    } else {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
      );
      const { data: ud } = await userClient.auth.getUser();
      userId = ud?.user?.id ?? null;
      authorized = !!userId;
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, owner_id, location_id, booking_date, booking_time, status, external_reservation_id, staff_id, sync_status, customer_id, total_duration_minutes, source_channel, external_source, needs_manual_review, customers(full_name)")
      .eq("id", booking_id).maybeSingle();
    if (!booking) {
      return new Response(JSON.stringify({ error: "booking_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      const code = "EXTERNAL_MIRROR_BOOKING_UPDATE_BLOCKED";
      await logExternalMirrorBlocked(supabase, booking, "update", code);
      return new Response(JSON.stringify({
        ok: false,
        success: false,
        code,
        error: code,
        message: "External SalonBoard mirror bookings cannot be updated from SalonBoost.",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // キャンセル済みは update 対象外
    if (booking.status === "cancelled") {
      return new Response(JSON.stringify({
        success: true, skipped: true, reason: "booking_cancelled",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // external_reservation_id 必須
    if (!booking.external_reservation_id) {
      await supabase.from("bookings").update({
        sync_status: "needs_review",
        needs_manual_review: true,
        sync_error_message: "[salonboard] external_reservation_id が無いため変更同期できません。先にサロンボード側で予約を作成するか、再送で新規作成してください。",
      }).eq("id", booking.id);
      return new Response(JSON.stringify({
        success: false, skipped: true, reason: "no_external_reservation_id",
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
        success: true, skipped: true, reason: "channel_not_live",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // staff → external stylistId 解決
    let stylistId = "0000000000";
    if (booking.staff_id) {
      const { data: m } = await supabase.from("staff_channel_mappings")
        .select("external_id").eq("staff_id", booking.staff_id)
        .eq("channel", "salonboard").eq("enabled", true).maybeSingle();
      if (m?.external_id) {
        stylistId = String(m.external_id);
      } else {
        // 担当が指定されているのにmapping無し → needs_review
        await supabase.from("bookings").update({
          sync_status: "needs_review",
          needs_manual_review: true,
          sync_error_message: "[salonboard] 担当スタッフのサロンボード側IDが未マッピングです。スタッフマッピングを設定してから再送してください。",
        }).eq("id", booking.id);
        return new Response(JSON.stringify({
          success: false, skipped: true, reason: "staff_mapping_missing",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const customerName = (booking as any).customers?.full_name ?? null;
    const timeHHMM = (booking.booking_time ?? "").slice(0, 5).replace(":", "");
    const rsvTerm = booking.total_duration_minutes && booking.total_duration_minutes > 0
      ? booking.total_duration_minutes : 60;

    const requestPayload = {
      external_reservation_id: booking.external_reservation_id,
      date: fmtDate(booking.booking_date),
      time: timeHHMM || null,
      stylistId,
      rsvTerm: String(rsvTerm),
      customerName,
    };

    // 重複防止: 同一予約の未完了 update ジョブがあれば payload 更新で再利用
    const { data: existing } = await supabase.from("sync_jobs")
      .select("id").eq("reservation_id", booking.id)
      .eq("target_channel", "salonboard").eq("job_type", "update_reservation")
      .in("status", ["pending", "processing"]).maybeSingle();

    let jobId: string | null = existing?.id ?? null;
    if (jobId) {
      await supabase.from("sync_jobs").update({
        request_payload: requestPayload, status: "pending",
        error_type: null, error_message: null,
      }).eq("id", jobId);
    } else {
      const { data: ins, error: insErr } = await supabase.from("sync_jobs").insert({
        owner_id: booking.owner_id,
        location_id: booking.location_id,
        reservation_id: booking.id,
        target_channel: "salonboard",
        job_type: "update_reservation",
        status: "pending",
        request_payload: requestPayload,
      }).select("id").maybeSingle();
      if (insErr) {
        return new Response(JSON.stringify({ error: "job_insert_failed", message: insErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      jobId = ins?.id ?? null;
    }

    await supabase.from("bookings").update({ sync_status: "pending" }).eq("id", booking.id);

    supabase.functions.invoke("sync-job-dispatch", {
      body: { reservation_id: booking.id, job_ids: jobId ? [jobId] : undefined },
    }).catch((e) => console.error("[sync-update] dispatch error:", e));

    return new Response(JSON.stringify({
      success: true, job_id: jobId, payload: requestPayload,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("sync-update-to-salonboard error:", e);
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
