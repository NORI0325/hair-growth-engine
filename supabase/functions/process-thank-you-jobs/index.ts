import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 24時間後にトリガーされるサンクスメール処理ジョブ
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 期限が来たpendingジョブを取得（最大100件）
    const { data: jobs, error } = await supabase
      .from("scheduled_jobs")
      .select("id, owner_id, customer_id, booking_id, payload")
      .eq("status", "pending")
      .eq("job_type", "thank_you")
      .lte("scheduled_for", new Date().toISOString())
      .limit(100);

    if (error) throw error;
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let success = 0, failed = 0;
    for (const job of jobs) {
      try {
        // 顧客情報＋サロン名を取得
        const { data: customer } = await supabase
          .from("customers")
          .select("id, full_name, email, phone")
          .eq("id", job.customer_id)
          .maybeSingle();
        const { data: profile } = await supabase
          .from("profiles")
          .select("salon_name")
          .eq("id", job.owner_id)
          .maybeSingle();
        const { data: tokenRow } = await supabase
          .from("booking_tokens")
          .select("token")
          .eq("customer_id", job.customer_id)
          .maybeSingle();

        if (!customer) {
          await supabase.from("scheduled_jobs").update({ status: "failed", error: "customer_not_found" }).eq("id", job.id);
          failed++;
          continue;
        }

        const salonName = profile?.salon_name || "サロン";
        const bookingLink = tokenRow?.token
          ? `${Deno.env.get("APP_ORIGIN") || "https://hair-growth-engine.lovable.app"}/book/${tokenRow.token}`
          : "";

        // 現状はログのみ（Lovable Emails設定後に実送信化）
        console.log(`[THANK-YOU] To: ${customer.email}, Salon: ${salonName}`);
        console.log(`本文: ${customer.full_name}様、本日はご来店ありがとうございました。次回ご予約で20%OFFクーポンをご用意しました → ${bookingLink}`);

        await supabase.from("scheduled_jobs").update({
          status: "sent",
          sent_at: new Date().toISOString(),
        }).eq("id", job.id);
        success++;
      } catch (e) {
        await supabase.from("scheduled_jobs").update({
          status: "failed",
          error: e instanceof Error ? e.message : "unknown",
        }).eq("id", job.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: jobs.length, success, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-thank-you-jobs error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
