import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 機密キーをマスク
const SENSITIVE_KEYS = ["password", "passwd", "pwd", "token", "cookie", "authorization", "auth", "secret", "api_key", "apikey"];
function maskSensitive(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitive);
  const out: any = {};
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      out[k] = "***";
    } else {
      out[k] = maskSensitive(obj[k]);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { reservation_id, job_ids } = await req.json();
    if (!reservation_id && !job_ids) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // dispatch対象ジョブ取得
    let jobsQuery = supabase
      .from("sync_jobs")
      .select("*")
      .in("status", ["pending"]);
    if (job_ids && Array.isArray(job_ids) && job_ids.length > 0) {
      jobsQuery = jobsQuery.in("id", job_ids);
    } else {
      jobsQuery = jobsQuery.eq("reservation_id", reservation_id);
    }
    const { data: jobs, error: jobsErr } = await jobsQuery;
    if (jobsErr) throw jobsErr;

    const workerUrl = Deno.env.get("EXTERNAL_WORKER_API_URL");
    const workerKey = Deno.env.get("EXTERNAL_WORKER_API_KEY");

    const results: any[] = [];

    for (const job of jobs || []) {
      // 外部ワーカー未設定の場合はpending据置（エラーにしない）
      if (!workerUrl) {
        results.push({ job_id: job.id, status: "pending", reason: "worker_not_configured" });
        continue;
      }

      // processing に更新
      await supabase.from("sync_jobs")
        .update({ status: "processing" })
        .eq("id", job.id);

      let resp: any = null;
      let httpStatus = 0;
      let errorType: string | null = null;
      let errorMessage: string | null = null;

      try {
        const res = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/sync-job`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(workerKey ? { "Authorization": `Bearer ${workerKey}` } : {}),
          },
          body: JSON.stringify({
            job_id: job.id,
            store_id: job.owner_id,
            location_id: job.location_id,
            reservation_id: job.reservation_id,
            target_channel: job.target_channel,
            job_type: ({ create_reservation: "create", update_reservation: "update", cancel_reservation: "cancel" } as Record<string, string>)[job.job_type] ?? job.job_type,
            reservation: job.request_payload,
          }),
        });
        httpStatus = res.status;
        resp = await res.json().catch(() => ({ success: false, error_type: "unknown_error", message: "invalid_json_response" }));
      } catch (e) {
        errorType = "network_error";
        errorMessage = e instanceof Error ? e.message : String(e);
      }

      const success = !errorType && resp?.success === true;
      const newJobStatus = success ? "success"
        : (resp?.error_type === "captcha_required" || resp?.error_type === "duplicate_risk" || resp?.error_type === "mapping_not_found")
          ? "needs_review"
          : "failed";

      const finalErrorType = errorType || (success ? null : (resp?.error_type || "unknown_error"));
      const finalErrorMessage = errorMessage || (success ? null : (resp?.message || `HTTP ${httpStatus}`));

      await supabase.from("sync_jobs")
        .update({
          status: newJobStatus,
          response_payload: resp ? maskSensitive(resp) : null,
          error_type: finalErrorType,
          error_message: finalErrorMessage,
          retry_count: job.retry_count + (success ? 0 : 1),
        })
        .eq("id", job.id);

      // 予約のsync_status更新（同一予約に複数ジョブがあれば最も悪い状態を反映）
      if (job.reservation_id) {
        const newResStatus = success ? "success" : newJobStatus;
        const updates: any = {
          sync_status: newResStatus,
          last_synced_at: new Date().toISOString(),
        };
        if (!success) {
          updates.sync_error_message = `[${job.target_channel}] ${finalErrorMessage}`;
          if (newJobStatus === "needs_review") updates.needs_manual_review = true;
        }
        await supabase.from("bookings").update(updates).eq("id", job.reservation_id);

        // 成功時は外部予約ID保存
        if (success && resp?.external_reservation_id) {
          await supabase.from("bookings").update({
            external_reservation_id: String(resp.external_reservation_id),
          }).eq("id", job.reservation_id);
        }
      }

      // channel_integrations 統計更新
      await supabase.from("channel_integrations")
        .update({
          last_synced_at: new Date().toISOString(),
          last_status: newJobStatus,
          last_error: success ? null : finalErrorMessage,
          failure_count: success ? 0 : ((await supabase.from("channel_integrations").select("failure_count").eq("owner_id", job.owner_id).eq("channel", job.target_channel).maybeSingle()).data?.failure_count ?? 0) + 1,
        })
        .eq("owner_id", job.owner_id)
        .eq("channel", job.target_channel);

      // log
      await supabase.from("sync_logs").insert({
        owner_id: job.owner_id,
        sync_job_id: job.id,
        reservation_id: job.reservation_id,
        channel: job.target_channel,
        level: success ? "info" : (newJobStatus === "needs_review" ? "warning" : "error"),
        message: success ? "外部媒体への同期成功" : `同期失敗: ${finalErrorType}`,
        metadata: maskSensitive({ http_status: httpStatus, response: resp, error: errorMessage }),
      });

      results.push({ job_id: job.id, status: newJobStatus, error_type: finalErrorType });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-job-dispatch error:", e);
    return new Response(JSON.stringify({ error: "Internal error", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
