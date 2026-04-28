import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// LINE Messaging API: Push Message
async function sendLinePush(token: string, userId: string, text: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, err: `LINE ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "unknown" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://hair-growth-engine.lovable.app";

  try {
    const { data: jobs, error } = await supabase
      .from("scheduled_jobs")
      .select("id, owner_id, customer_id, booking_id, job_type, payload")
      .eq("status", "pending")
      .in("job_type", ["thank_you", "birthday", "review_request"])
      .lte("scheduled_for", new Date().toISOString())
      .limit(200);

    if (error) throw error;
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let success = 0, failed = 0;
    for (const job of jobs) {
      try {
        const { data: customer } = await supabase
          .from("customers")
          .select("id, full_name, email, phone, line_user_id")
          .eq("id", job.customer_id)
          .maybeSingle();
        const { data: profile } = await supabase
          .from("profiles")
          .select("salon_name, google_review_url, line_channel_access_token")
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
        const bookingLink = tokenRow?.token ? `${APP_ORIGIN}/book/${tokenRow.token}` : "";
        const lineToken = profile?.line_channel_access_token;

        let templateName = "";
        let templateData: Record<string, any> = {};
        let body = ""; // LINE用テキスト

        if (job.job_type === "thank_you") {
          templateName = "thank-you";
          templateData = { customerName: customer.full_name, salonName, bookingLink, menu: (job.payload as any)?.menu };
          body = `${customer.full_name}様\n本日はご来店ありがとうございました。\n次回ご予約で20%OFFクーポンをご用意しました。\n→ ${bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "birthday") {
          templateName = "birthday";
          templateData = { customerName: customer.full_name, salonName, bookingLink };
          body = `${customer.full_name}様\nお誕生月おめでとうございます🎂\n30%OFFのバースデークーポンをお贈りします。\n→ ${bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "review_request") {
          const reviewUrl = profile?.google_review_url;
          if (!reviewUrl) {
            await supabase.from("scheduled_jobs").update({ status: "skipped", error: "no_review_url" }).eq("id", job.id);
            continue;
          }
          templateName = "review-request";
          templateData = { customerName: customer.full_name, salonName, reviewUrl };
          body = `${customer.full_name}様\nいつもご来店ありがとうございます。\nもしよろしければGoogleでサロンのご感想をいただけますと大変嬉しいです🙇‍♀️\n→ ${reviewUrl}\n\n${salonName}`;
        }

        // === 配信チャネル決定ロジック（重複防止）===
        // ルール：LINE連携済み → LINEのみ / 未連携 → メールのみ
        const hasLine = !!(lineToken && customer.line_user_id);
        let lineErr: string | undefined;
        let channelUsed: "line" | "email" | "none" = "none";

        if (hasLine) {
          const r = await sendLinePush(lineToken!, customer.line_user_id!, body);
          if (r.ok) {
            channelUsed = "line";
            console.log(`[LINE] sent to ${customer.line_user_id}`);
          } else {
            lineErr = r.err;
            // LINE失敗時はメールにフォールバック
            if (customer.email && templateName) {
              await supabase.functions.invoke("send-transactional-email", {
                body: {
                  templateName,
                  recipientEmail: customer.email,
                  idempotencyKey: `${job.job_type}-${job.id}-fallback`,
                  templateData,
                },
              });
              channelUsed = "email";
            }
          }
        } else if (customer.email && templateName) {
          await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName,
              recipientEmail: customer.email,
              idempotencyKey: `${job.job_type}-${job.id}`,
              templateData,
            },
          });
          channelUsed = "email";
        }

        await supabase.from("scheduled_jobs").update({
          status: channelUsed === "none" ? "skipped" : "sent",
          sent_at: new Date().toISOString(),
          error: lineErr || (channelUsed === "none" ? "no_channel" : null),
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
