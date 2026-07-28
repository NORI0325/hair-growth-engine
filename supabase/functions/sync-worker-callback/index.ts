import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { isExternalMirrorBooking } from "../_shared/external-mirror-booking.ts";

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

// 外部ワーカーからの非同期コールバック受信
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const sharedSecret = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    const auth = req.headers.get("authorization") || "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const reason = !sharedSecret ? "EXTERNAL_WORKER_API_KEY missing in edge secrets"
      : !auth ? "missing Authorization header"
      : !auth.startsWith("Bearer ") ? "Authorization header is not Bearer"
      : !timingSafeEqual(provided, sharedSecret) ? "invalid bearer token"
      : null;
    if (reason) {
      console.error("[sync-worker-callback] unauthorized", { reason });
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { job_id, success, external_reservation_id, error_type, message } = body;
    if (typeof job_id !== "string" || !/^[0-9a-f-]{36}$/i.test(job_id) || typeof success !== "boolean") {
      return new Response(JSON.stringify({ error: "missing_job_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: job } = await supabase.from("sync_jobs").select("*").eq("id", job_id).maybeSingle();
    if (!job) {
      return new Response(JSON.stringify({ error: "job_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (job.status === "success" && success) {
      return new Response(JSON.stringify({ success: true, duplicate_callback: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (job.status !== "processing") {
      return new Response(JSON.stringify({ error: "job_not_processing", status: job.status }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let booking: any = null;
    if (job.reservation_id) {
      const { data } = await supabase.from("bookings")
        .select("id, owner_id, location_id, source_channel, external_source, external_reservation_id, sync_status")
        .eq("id", job.reservation_id)
        .eq("owner_id", job.owner_id)
        .maybeSingle();
      booking = data;
      if (isExternalMirrorBooking(booking)) {
        return new Response(JSON.stringify({ error: "external_mirror_booking_blocked" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const newJobStatus = success ? "success"
      : (error_type === "captcha_required" || error_type === "duplicate_risk" || error_type === "mapping_not_found")
        ? "needs_review" : "failed";

    const safeMessage = typeof message === "string" ? message.slice(0, 1000) : null;
    const safeErrorType = typeof error_type === "string" ? error_type.slice(0, 100) : null;
    const safeExternalId = typeof external_reservation_id === "string" ? external_reservation_id.slice(0, 100) : null;
    const { data: updatedJob, error: updateJobError } = await supabase.from("sync_jobs").update({
      status: newJobStatus,
      response_payload: { success, external_reservation_id: safeExternalId, error_type: safeErrorType },
      error_type: success ? null : (safeErrorType || "unknown_error"),
      error_message: success ? null : safeMessage,
    }).eq("id", job_id).eq("status", "processing").select("id").maybeSingle();
    if (updateJobError) throw updateJobError;
    if (!updatedJob) {
      return new Response(JSON.stringify({ error: "job_state_changed" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (job.reservation_id) {
      const updates: any = {
        sync_status: success ? "success" : newJobStatus,
        last_synced_at: new Date().toISOString(),
      };
      if (!success) {
        updates.sync_error_message = `[${job.target_channel}] ${safeMessage || safeErrorType}`;
        if (newJobStatus === "needs_review") updates.needs_manual_review = true;
      }
      if (success && safeExternalId) {
        updates.external_reservation_id = safeExternalId;
      }
      const { error: bookingUpdateError } = await supabase.from("bookings")
        .update(updates)
        .eq("owner_id", job.owner_id)
        .eq("id", job.reservation_id);
      if (bookingUpdateError) {
        await supabase.from("sync_jobs").update({
          status: "needs_review",
          error_type: "booking_update_failed",
          error_message: "External operation completed but local booking update failed",
        }).eq("id", job_id);
        return new Response(JSON.stringify({ error: "booking_update_failed" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Phase2: create_reservation 成功時のみ pending→confirmed 昇格
      if (success && job.job_type === "create_reservation") {
        const { data: bk } = await supabase.from("bookings")
          .select("status").eq("id", job.reservation_id).maybeSingle();
        if (bk?.status === "pending") {
          const { error: confirmError } = await supabase.from("bookings")
            .update({ status: "confirmed" })
            .eq("owner_id", job.owner_id)
            .eq("id", job.reservation_id);
          if (confirmError) {
            await supabase.from("sync_jobs").update({
              status: "needs_review",
              error_type: "booking_confirmation_failed",
              error_message: "SalonBoard succeeded but local confirmation failed",
            }).eq("id", job_id);
            return new Response(JSON.stringify({ error: "booking_confirmation_failed" }), {
              status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          // 反映成功通知（軽量・LINEのみ）
          supabase.functions.invoke("notify-owner-booking", {
            body: { bookingId: job.reservation_id, eventType: "sync_succeeded" },
          }).catch((e: any) => console.error("[sync-worker-callback] notify sync_succeeded error:", e));
        }
      }
    }

    await supabase.from("sync_logs").insert({
      owner_id: job.owner_id,
      sync_job_id: job.id,
      reservation_id: job.reservation_id,
      channel: job.target_channel,
      level: success ? "info" : (newJobStatus === "needs_review" ? "warning" : "error"),
      message: success ? "外部ワーカーから成功コールバック受信" : `外部ワーカーから失敗コールバック: ${error_type}`,
      metadata: { callback: true, error_type: safeErrorType },
    });

    // 失敗時はオーナー/管理者へ即時通知（通知失敗はメイン処理を止めない）
    if (!success && job.reservation_id && (newJobStatus === "failed" || newJobStatus === "needs_review")) {
      supabase.functions.invoke("notify-sync-failure", {
        body: {
          bookingId: job.reservation_id,
          ownerId: job.owner_id,
          channel: job.target_channel || "salonboard",
          errorMessage: safeMessage || safeErrorType || "unknown_error",
        },
      }).catch((e: any) => console.error("[sync-worker-callback] notify-sync-failure invoke error:", e));
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-worker-callback error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
