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
      .in("job_type", ["thank_you", "birthday", "review_request", "reminder", "reactivation", "aftercare", "next_suggestion"])
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
        } else if (job.job_type === "reminder") {
          // 予約前日リマインド：LINEのみ（メール未連携客には送らない＝うっとうしさ回避）
          const p = (job.payload as any) || {};
          const dateStr = p.booking_date || "";
          const timeStr = (p.booking_time || "").slice(0, 5);
          const menu = p.menu || "";
          body = `🌸 明日のご予約のリマインドです\n\n${customer.full_name}様\n\n📅 ${dateStr}\n🕐 ${timeStr}\n💇 ${menu}\n\nお会いできるのを楽しみにしております。\n変更・キャンセルは恐れ入りますが、こちらから：\n→ ${bookingLink}\n\n${salonName}`;
          // メールテンプレは作らずLINE限定運用
          templateName = "";
        } else if (job.job_type === "reactivation") {
          const days = (job.payload as any)?.days_since || 90;
          body = `${customer.full_name}様\n\nお久しぶりです。前回ご来店から${days}日が経ちました。\nまた${salonName}でお会いできるのを楽しみにしております🌸\n\n【復活キャンペーン】次回ご予約で20%OFF\n→ ${bookingLink}`;
          templateName = "";
        } else if (job.job_type === "aftercare") {
          const menu = (job.payload as any)?.menu || "";
          body = `${customer.full_name}様\n\n先日は${menu ? `${menu}で` : ""}ご来店ありがとうございました🌸\n\nそろそろ1週間。仕上がりはいかがでしょうか？\n\n💡 美しさを長持ちさせるコツ\n・洗髪後はタオルドライ→すぐドライヤー\n・週1〜2回のヘアマスクで保湿\n・紫外線対策に洗い流さないトリートメント\n\nお気軽にご相談ください。\n${salonName}`;
          templateName = "";
        } else if (job.job_type === "next_suggestion") {
          body = `${customer.full_name}様\n\n前回のご来店から1ヶ月が経ちました。\n根元の伸び・カラーの色落ちが気になり始める時期です✨\n\n今ご予約いただくと、ご希望のお日にちが選びやすくなっております。\n→ ${bookingLink}\n\n${salonName}`;
          templateName = "";
        }

        // === 配信チャネル決定ロジック（重複防止）===
        // ルール：LINE連携済み → LINEのみ / 未連携 → メールのみ
        const hasLine = !!(lineToken && customer.line_user_id);
        let lineErr: string | undefined;
        let channelUsed: "line" | "email" | "none" = "none";

        if (hasLine) {
          const r = await sendLinePush(lineToken!, customer.line_user_id!, body);
          // ログ記録
          await supabase.from("line_message_log").insert({
            owner_id: job.owner_id,
            customer_id: customer.id,
            job_type: job.job_type,
            line_user_id: customer.line_user_id,
            message: body,
            status: r.ok ? "sent" : "failed",
            error: r.ok ? null : r.err,
          } as any);
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
