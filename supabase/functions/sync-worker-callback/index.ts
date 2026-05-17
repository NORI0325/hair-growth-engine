import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 外部ワーカーからの非同期コールバック受信
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sharedSecret = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    const auth = req.headers.get("authorization") || "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const reason = !sharedSecret ? "EXTERNAL_WORKER_API_KEY missing in edge secrets"
      : !auth ? "missing Authorization header"
      : !auth.startsWith("Bearer ") ? "Authorization header is not Bearer"
      : provided !== sharedSecret ? "Bearer token mismatch (worker WORKER_API_KEY != edge EXTERNAL_WORKER_API_KEY)"
      : null;
    if (reason) {
      console.error("[sync-worker-callback] 401", {
        reason,
        expected_present: !!sharedSecret,
        expected_len: sharedSecret?.length ?? 0,
        provided_len: provided.length,
        expected_prefix: sharedSecret ? sharedSecret.slice(0, 4) : null,
        provided_prefix: provided ? provided.slice(0, 4) : null,
      });
      return new Response(JSON.stringify({ error: "unauthorized", reason }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { job_id, success, external_reservation_id, error_type, message } = body;
    if (!job_id) {
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

    const newJobStatus = success ? "success"
      : (error_type === "captcha_required" || error_type === "duplicate_risk" || error_type === "mapping_not_found")
        ? "needs_review" : "failed";

    await supabase.from("sync_jobs").update({
      status: newJobStatus,
      response_payload: body,
      error_type: success ? null : (error_type || "unknown_error"),
      error_message: success ? null : (message || null),
    }).eq("id", job_id);

    if (job.reservation_id) {
      const updates: any = {
        sync_status: success ? "success" : newJobStatus,
        last_synced_at: new Date().toISOString(),
      };
      if (!success) {
        updates.sync_error_message = `[${job.target_channel}] ${message || error_type}`;
        if (newJobStatus === "needs_review") updates.needs_manual_review = true;
      }
      if (success && external_reservation_id) {
        updates.external_reservation_id = String(external_reservation_id);
      }
      await supabase.from("bookings").update(updates).eq("id", job.reservation_id);

      // Phase2: create_reservation 成功時のみ pending→confirmed 昇格
      if (success && job.job_type === "create_reservation") {
        const { data: bk } = await supabase.from("bookings")
          .select("status").eq("id", job.reservation_id).maybeSingle();
        if (bk?.status === "pending") {
          await supabase.from("bookings")
            .update({ status: "confirmed" }).eq("id", job.reservation_id);
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
      metadata: { callback: true, message },
    });

    // 失敗時はオーナー/管理者へ即時通知（通知失敗はメイン処理を止めない）
    if (!success && job.reservation_id && (newJobStatus === "failed" || newJobStatus === "needs_review")) {
      supabase.functions.invoke("notify-sync-failure", {
        body: {
          bookingId: job.reservation_id,
          ownerId: job.owner_id,
          channel: job.target_channel || "salonboard",
          errorMessage: message || error_type || "unknown_error",
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
