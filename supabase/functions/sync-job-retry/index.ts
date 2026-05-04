import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 要確認画面からの手動再同期。最大3回まで。
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
    if ((job.retry_count ?? 0) >= 3) {
      return new Response(JSON.stringify({ error: "retry_limit_reached", message: "再試行は3回までです。設定や外部媒体側をご確認ください。" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 一旦pendingに戻す
    await supabase.from("sync_jobs").update({ status: "pending", error_type: null, error_message: null }).eq("id", sync_job_id);

    // dispatch呼び出し
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
