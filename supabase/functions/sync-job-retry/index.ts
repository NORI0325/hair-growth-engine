import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 再試行可否マップ
const RETRYABLE = new Set(["network_error", "timeout", "temporary_external_error"]);
const NON_RETRYABLE = new Set([
  "mapping_not_found", "captcha_required", "duplicate_risk",
  "capacity_exceeded", "out_of_business_hours", "required_field_missing",
  "login_failed",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sync_job_id } = await req.json();
    if (!sync_job_id) {
      return new Response(JSON.stringify({ error: "missing_sync_job_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job } = await supabase.from("sync_jobs").select("*").eq("id", sync_job_id).maybeSingle();
    if (!job) {
      return new Response(JSON.stringify({ error: "job_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (job.error_type && NON_RETRYABLE.has(job.error_type)) {
      return new Response(JSON.stringify({
        error: "not_retryable",
        error_type: job.error_type,
        message: "このエラーは自動再試行できません。マッピング・設定・サロンボード側を確認してください。",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if ((job.retry_count ?? 0) >= 3) {
      return new Response(JSON.stringify({ error: "retry_limit_reached", message: "再試行は3回までです。" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("sync_jobs").update({ status: "pending", error_type: null, error_message: null }).eq("id", sync_job_id);
    const dispatchRes = await supabase.functions.invoke("sync-job-dispatch", {
      body: { job_ids: [sync_job_id] },
    });

    return new Response(JSON.stringify({ success: true, dispatch: dispatchRes.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-job-retry error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
