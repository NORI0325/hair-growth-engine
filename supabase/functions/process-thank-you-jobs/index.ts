import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendSms } from "../_shared/twilio-sms.ts";

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

// JST(UTC+9)の現在時刻の「時(0-23)」を取得
function jstHourNow(): number {
  const utcMs = Date.now();
  const jst = new Date(utcMs + 9 * 60 * 60 * 1000);
  return jst.getUTCHours();
}

// 「次の朝10時(JST)」のtimestamptzを返す
function nextJstMorning(hour = 10): Date {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const targetJst = new Date(Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate(),
    hour, 0, 0, 0
  ));
  // 既にその時刻を過ぎていたら翌日
  if (targetJst.getTime() <= jstNow.getTime()) {
    targetJst.setUTCDate(targetJst.getUTCDate() + 1);
  }
  // JST→UTC
  return new Date(targetJst.getTime() - 9 * 60 * 60 * 1000);
}

// 配信窓: JST 10:00〜20:00 のみ送信可
function isWithinSendWindow(): boolean {
  const h = jstHourNow();
  return h >= 10 && h < 20;
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
      .select("id, owner_id, customer_id, booking_id, job_type, payload, scheduled_for, approval_status")
      .eq("status", "pending")
      // 半自動: 承認待ち/却下のジョブはスキップ。auto と approved のみ送信。
      .in("approval_status", ["auto", "approved"])
      .in("job_type", ["thank_you", "birthday", "review_request", "reminder", "reactivation", "aftercare", "next_suggestion", "welcome", "anniversary", "vip_upgrade", "referral_thanks", "holiday_notice"])
      .lte("scheduled_for", new Date().toISOString())
      .limit(200);

    if (error) throw error;
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ====== 深夜帯ガード ======
    // リマインダーは前日の指定時刻配信なのでガード対象外（オーナー設定どおり）
    // それ以外のジョブで配信窓外(JST 20:00〜翌10:00)に発火したものは、次の朝10時にリスケ
    if (!isWithinSendWindow()) {
      const targetReschedule = nextJstMorning(10).toISOString();
      const reschedTargets = jobs.filter(j => j.job_type !== "reminder");
      if (reschedTargets.length > 0) {
        const ids = reschedTargets.map(j => j.id);
        await supabase
          .from("scheduled_jobs")
          .update({ scheduled_for: targetReschedule })
          .in("id", ids);
      }
      // リマインダーのみ通常処理を続行
      const reminderJobs = jobs.filter(j => j.job_type === "reminder");
      if (reminderJobs.length === 0) {
        return new Response(JSON.stringify({
          processed: 0,
          rescheduled_for_morning: reschedTargets.length,
          note: "outside_send_window_jst",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // リマインダーだけ jobs を絞る
      jobs.length = 0;
      jobs.push(...reminderJobs);
    }

    let success = 0, failed = 0;
    for (const job of jobs) {
      try {
        const { data: customer } = await supabase
          .from("customers")
          .select("id, full_name, email, phone, birthday, line_user_id, opt_out_automation, quiet_until, imported_from, activated_at, info_request_last_sent_at")
          .eq("id", job.customer_id)
          .maybeSingle();

        // 過去来店ベースのジョブは「アクティブ化済み顧客」のみに送る
        // （サロンボードからの一括インポート直後で予約も来店も無い顧客には送らない）
        const PAST_VISIT_JOBS = new Set(["thank_you", "aftercare", "next_suggestion", "reminder", "review_request"]);
        if (
          customer &&
          PAST_VISIT_JOBS.has(job.job_type) &&
          (customer as any).imported_from === "salonboard" &&
          !(customer as any).activated_at
        ) {
          await supabase.from("scheduled_jobs").update({
            status: "skipped",
            error: "dormant_imported_customer",
            sent_at: new Date().toISOString(),
          }).eq("id", job.id);
          continue;
        }
        const { data: profile } = await supabase
          .from("profiles")
          .select("salon_name, google_review_url, line_channel_access_token, frequency_cap_days, frequency_cap_per_month, info_collection_enabled, info_collection_append_to_thanks")
          .eq("id", job.owner_id)
          .maybeSingle();

        // ====== Send Guard: 頻度キャップ + オプトアウト + 沈黙期間 ======
        // リマインダーは予約時点で顧客が明示的に求めた配信なのでスキップ対象外
        if (customer && job.job_type !== "reminder") {
          const capDays = (profile as any)?.frequency_cap_days ?? 7;
          const capMonth = (profile as any)?.frequency_cap_per_month ?? 4;
          const { data: guardResult } = await supabase.rpc("can_send_to_customer" as any, {
            _customer_id: job.customer_id,
            _cap_days: capDays,
            _cap_per_month: capMonth,
          });
          const guard = guardResult as any;
          if (guard && guard.allowed === false) {
            await supabase.from("scheduled_jobs").update({
              status: "skipped",
              error: `send_guard:${guard.reason}`,
              sent_at: new Date().toISOString(),
            }).eq("id", job.id);
            continue;
          }
        }
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
        const myBookingsLink = tokenRow?.token ? `${APP_ORIGIN}/my-bookings/${tokenRow.token}` : "";
        const lineToken = profile?.line_channel_access_token;

        const jobTypeToTemplateKey: Record<string, string> = {
          thank_you: "thank-you", birthday: "birthday", review_request: "review-request",
          reminder: "booking-reminder", reactivation: "reactivation",
          aftercare: "aftercare", next_suggestion: "next-suggestion",
          welcome: "welcome-new-customer", anniversary: "anniversary",
          vip_upgrade: "vip-upgrade", referral_thanks: "referral-thanks",
          holiday_notice: "holiday-notice",
        };
        const tmplKey = jobTypeToTemplateKey[job.job_type] || job.job_type;

        // 利用可能チャネルから優先順にoverrideを取得（line→email→sms）
        const hasLine = !!(lineToken && customer.line_user_id);
        const hasEmail = !!customer.email;
        const hasPhone = !!customer.phone;

        // 想定する第一チャネル（overrideのkey用）
        const primaryChannel: "line" | "email" | "sms" =
          hasLine ? "line" : hasEmail ? "email" : hasPhone ? "sms" : "email";

        const { data: override } = await supabase
          .from("template_overrides")
          .select("*")
          .eq("owner_id", job.owner_id)
          .eq("channel", primaryChannel === "sms" ? "email" : primaryChannel) // SMSはemailのoverrideを流用
          .eq("template_key", tmplKey)
          .maybeSingle();

        if (override && override.enabled === false) {
          await supabase.from("scheduled_jobs").update({ status: "skipped", error: "template_disabled" }).eq("id", job.id);
          continue;
        }

        // クーポン取得
        let couponText = "";
        if (override?.coupon_id) {
          const { data: coupon } = await supabase
            .from("coupons")
            .select("title, description, discount_type, discount_value, expires_at")
            .eq("id", override.coupon_id).maybeSingle();
          if (coupon) {
            const value = coupon.discount_type === "percent" ? `${coupon.discount_value}%OFF` : `¥${coupon.discount_value}OFF`;
            couponText = `\n\n🎁 ${coupon.title} (${value})${coupon.expires_at ? ` ※${coupon.expires_at}まで` : ""}`;
          }
        }

        let templateName = "";
        let templateData: Record<string, any> = {};
        let body = "";

        if (job.job_type === "thank_you") {
          templateName = "thank-you";
          templateData = { customerName: customer.full_name, salonName, bookingLink, menu: (job.payload as any)?.menu };
          body = `${customer.full_name}様\n\n昨日はご来店ありがとうございました。\n仕上がりはいかがでしょうか？\n\nまたお会いできるのを楽しみにしております。\n\n${salonName}`;
        } else if (job.job_type === "birthday") {
          const bDiscount = Number((job.payload as any)?.discount_percent) || 30;
          templateName = "birthday";
          templateData = { customerName: customer.full_name, salonName, bookingLink, discountPercent: bDiscount };
          body = `${customer.full_name}様\nお誕生月おめでとうございます🎂\n感謝を込めて ${bDiscount}%OFF のバースデークーポンをお贈りします。\n→ ${bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "review_request") {
          const reviewUrl = profile?.google_review_url;
          if (!reviewUrl) {
            await supabase.from("scheduled_jobs").update({ status: "skipped", error: "no_review_url" }).eq("id", job.id);
            continue;
          }
          templateName = "review-request";
          templateData = { customerName: customer.full_name, salonName, reviewUrl };
          body = `${customer.full_name}様\n\n先日はご来店ありがとうございました。\nもしよろしければ、Googleでサロンのご感想をいただけますと大変嬉しいです🙇‍♀️\n→ ${reviewUrl}\n\n${salonName}`;
        } else if (job.job_type === "reminder") {
          const p = (job.payload as any) || {};
          const dateStr = p.booking_date || "";
          const timeStr = (p.booking_time || "").slice(0, 5);
          const menu = p.menu || "";
          templateName = "booking-reminder";
          templateData = { customerName: customer.full_name, salonName, bookingDate: dateStr, bookingTime: timeStr, menu, bookingLink };
          body = `🌸 明日のご予約のリマインドです\n\n${customer.full_name}様\n\n📅 ${dateStr}\n🕐 ${timeStr}\n💇 ${menu}\n\nお会いできるのを楽しみにしております。\n変更・キャンセルはこちらから：\n→ ${myBookingsLink || bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "reactivation") {
          const p = (job.payload as any) || {};
          const stage = Number(p.stage) || 1;
          const days = p.days_since || 30;
          let discount = Number(p.discount_percent) || 0;
          const label = String(p.label || "").trim();
          const segment: string = String(p.segment || "");

          // セグメント別テンプレ取得
          let segTpl: any = null;
          if (segment) {
            const { data } = await supabase
              .from("reactivation_segment_templates")
              .select("*")
              .eq("owner_id", job.owner_id)
              .eq("segment", segment)
              .maybeSingle();
            segTpl = data;
          }

          // VIP-Lostは絶対に自動配信しない（保険：approval_statusでもブロック済みだが念押し）
          if (segment === "vip_lost") {
            await supabase.from("scheduled_jobs").update({
              status: "skipped",
              error: "vip_lost_requires_manual",
              sent_at: new Date().toISOString(),
            }).eq("id", job.id);
            continue;
          }
          if (segTpl && segTpl.enabled === false) {
            await supabase.from("scheduled_jobs").update({
              status: "skipped",
              error: `segment_template_disabled:${segment}`,
              sent_at: new Date().toISOString(),
            }).eq("id", job.id);
            continue;
          }

          if (segTpl?.discount_percent != null) discount = Number(segTpl.discount_percent);

          templateName = "reactivation";
          templateData = { customerName: customer.full_name, salonName, bookingLink, daysSince: days, stage, discountPercent: discount, label, segment };

          const monthsSince = Math.round(days / 30);
          const couponLine = discount > 0
            ? `\n\n🎁 ${label || "ご愛顧感謝"} クーポン ${discount}%OFF\n（45日間限定）`
            : "";

          if (segTpl?.body) {
            // セグメント別カスタム本文
            body = String(segTpl.body)
              .replace(/\{customer_name\}/g, customer.full_name)
              .replace(/\{salon_name\}/g, salonName)
              .replace(/\{months_since\}/g, String(monthsSince))
              .replace(/\{days_since\}/g, String(days)) + couponLine + `\n\n→ ${bookingLink}\n\n${salonName}`;
          } else {
            // セグメント別デフォルト
            const intro =
              segment === "cold_1" ? `以前は${salonName}にお越しいただきありがとうございました。\n改めまして、当店の魅力を少しご紹介させてください。`
              : segment === "warm_mid" ? `いつもありがとうございます。\n少し間が空いてしまいましたね。お変わりなくお過ごしでしょうか。`
              : segment === "loyal_risk" ? `いつも${salonName}をご愛顧いただき、本当にありがとうございます。\n少しお会いできていないのが気がかりで、ご連絡いたしました。`
              : segment === "lost_1" ? `以前は${salonName}にお立ち寄りいただきありがとうございました。\n季節のご挨拶を兼ねてご案内です。`
              : segment === "churned" ? `ご無沙汰しております。${salonName}でございます。\n以前のご来店で至らぬ点がございましたら、心よりお詫び申し上げます。`
              : days <= 35 ? `いつもありがとうございます。\n前回ご来店から約${monthsSince}ヶ月ほど経ちました🌸`
              : days <= 70 ? `お久しぶりです。前回から約${monthsSince}ヶ月が経ちました。`
              : `少しお時間が空いてしまいましたね。\nお元気でお過ごしでしょうか。`;
            body = `${customer.full_name}様\n\n${intro}${couponLine}\n\n→ ${bookingLink}\n\n${salonName}`;
          }
        } else if (job.job_type === "aftercare") {
          const menu = (job.payload as any)?.menu || "";
          templateName = "aftercare";
          templateData = { customerName: customer.full_name, salonName, menu };
          body = `${customer.full_name}様\n\n先日は${menu ? `${menu}で` : ""}ご来店ありがとうございました🌸\n\nそろそろ1週間。仕上がりはいかがでしょうか？\n\n💡 美しさを長持ちさせるコツ\n・洗髪後はタオルドライ→すぐドライヤー\n・週1〜2回のヘアマスクで保湿\n・紫外線対策に洗い流さないトリートメント\n\nお気軽にご相談ください。\n${salonName}`;
        } else if (job.job_type === "next_suggestion") {
          const days = (job.payload as any)?.days_since_visit || 30;
          templateName = "next-suggestion";
          templateData = { customerName: customer.full_name, salonName, bookingLink };
          body = `${customer.full_name}様\n\n前回のご来店から約${days}日が経ちました。\n根元の伸び・カラーの色落ちが気になり始める時期です✨\n\nお早めのご予約で、ご希望のお日にちが選びやすくなっております。\n→ ${bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "welcome") {
          templateName = "welcome-new-customer";
          templateData = { customerName: customer.full_name, salonName, bookingLink };
          body = `${customer.full_name}様\n\nこのたびは${salonName}にご縁をいただき、誠にありがとうございます🌸\n\nどうぞリラックスしてお過ごしいただけるよう、心を込めてお迎えいたします。\nご予約・お気軽なご相談はこちらから：\n→ ${bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "anniversary") {
          const years = Number((job.payload as any)?.years) || 1;
          templateName = "anniversary";
          templateData = { customerName: customer.full_name, salonName, years, bookingLink };
          body = `${customer.full_name}様\n\n${salonName}にお越しいただいて、本日でちょうど${years}周年です🎉\n\n大切な節目に、心からの感謝をお伝えさせてください。\nこれからも${customer.full_name}様の美しさを、丁寧にお手伝いしてまいります。\n\n→ ${bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "vip_upgrade") {
          const tier = String((job.payload as any)?.tier || "gold");
          const tierJa: Record<string,string> = { silver: "シルバー", gold: "ゴールド", platinum: "プラチナ" };
          templateName = "vip-upgrade";
          templateData = { customerName: customer.full_name, salonName, tier };
          body = `${customer.full_name}様\n\nいつも${salonName}をご愛顧いただき、心より感謝申し上げます。\n\n👑 このたび ${tierJa[tier] || tier} メンバーへご昇格されました。\n\n${customer.full_name}様の温かなご来店があってこその節目です。\nこれからも特別なひとときをご用意してお待ちしております。\n\n${salonName}`;
        } else if (job.job_type === "referral_thanks") {
          // 紹介者(referrer)のcustomer_idがjob.customer_idに入っている
          const referredId = (job.payload as any)?.referred_customer_id;
          let referredName = "";
          if (referredId) {
            const { data: ref } = await supabase
              .from("customers").select("full_name").eq("id", referredId).maybeSingle();
            referredName = ref?.full_name || "";
          }
          templateName = "referral-thanks";
          templateData = { customerName: customer.full_name, salonName, referredName, bookingLink };
          body = `${customer.full_name}様\n\n${salonName}にご紹介いただき、誠にありがとうございました🌸\n${referredName ? `${referredName}様をご紹介いただいたこと、心より感謝申し上げます。\n\n` : ""}${customer.full_name}様からの大切なご紹介は、私たちにとって何よりの励みです。\nささやかではございますが、感謝の気持ちをお贈りいたします。\n\n→ ${bookingLink}\n\n${salonName}`;
        } else if (job.job_type === "holiday_notice") {
          const p = (job.payload as any) || {};
          templateName = "holiday-notice";
          templateData = {
            customerName: customer.full_name, salonName,
            noticeTitle: p.noticeTitle || "休業のお知らせ",
            noticeBody: p.noticeBody || "",
            startDate: p.startDate || "",
            endDate: p.endDate || "",
          };
          body = `${customer.full_name}様\n\nいつも${salonName}をご利用いただき、誠にありがとうございます。\n\n${p.noticeTitle || "休業のお知らせ"}\n${p.noticeBody || ""}\n${p.startDate ? `\n期間：${p.startDate}${p.endDate ? ` 〜 ${p.endDate}` : ""}` : ""}\n\nご不便をおかけしますが、何卒よろしくお願いいたします。\n\n${salonName}`;
        }

        // オーナーカスタマイズ上書き
        const renderVars = (s: string) => s
          .replace(/\{\{customer_name\}\}/g, customer.full_name)
          .replace(/\{\{salon_name\}\}/g, salonName)
          .replace(/\{\{menu\}\}/g, (job.payload as any)?.menu || "")
          .replace(/\{\{booking_link\}\}/g, bookingLink)
          .replace(/\{\{days_since\}\}/g, String((job.payload as any)?.days_since || ""));

        if (override && (override.greeting || override.body)) {
          const greeting = override.greeting ? renderVars(override.greeting) : `${customer.full_name}様`;
          const customBody = override.body ? renderVars(override.body) : "";
          const ctaLabel = override.cta_label || "ご予約はこちら";
          const ctaUrl = override.cta_url || bookingLink;
          const signature = override.signature || salonName;
          body = `${greeting}\n\n${customBody}${couponText}\n\n→ ${ctaLabel}: ${ctaUrl}\n\n${signature}`;
          templateData = { ...templateData, override: { greeting, body: customBody, ctaLabel, ctaUrl, signature, couponText } };
        } else if (couponText) {
          body = body + couponText;
          templateData = { ...templateData, couponText };
        }

        // ====== チャネル優先ロジック: LINE → メール → SMS ======
        let channelUsed: "line" | "email" | "sms" | "none" = "none";
        let lastErr: string | undefined;

        // ====== サンキュー系LINE末尾に「未収集情報のお願い」を自動同梱 ======
        // 対象: thank_you / aftercare / next_suggestion （来店後フォロー系）かつ LINE連携済み
        let infoRequestApplied = false;
        const APPEND_TARGET_JOBS = new Set(["thank_you", "aftercare", "next_suggestion"]);
        if (
          hasLine
          && APPEND_TARGET_JOBS.has(job.job_type)
          && (profile as any)?.info_collection_enabled !== false
          && (profile as any)?.info_collection_append_to_thanks !== false
        ) {
          const missing: string[] = [];
          if (!customer.birthday) missing.push("🎂 誕生日（例：1990/5/12）— 誕生月クーポンをお届け");
          if (!customer.email) missing.push("📧 メールアドレス — 限定クーポンの案内に");
          // 30日以内に依頼済みなら今回はスキップ（しつこくしない）
          const lastReq = customer.info_request_last_sent_at
            ? new Date(customer.info_request_last_sent_at as any).getTime() : 0;
          const within30days = lastReq > 0 && (Date.now() - lastReq) < 30 * 24 * 60 * 60 * 1000;
          if (missing.length > 0 && !within30days) {
            body = body + `\n\n────────\nP.S. よろしければ、以下をこのトークに送ってください✨\n${missing.join("\n")}`;
            infoRequestApplied = true;
          }
        }

        // 1) LINE
        if (channelUsed === "none" && hasLine) {
          const r = await sendLinePush(lineToken!, customer.line_user_id!, body);
          await supabase.from("line_message_log").insert({
            owner_id: job.owner_id,
            customer_id: customer.id,
            job_type: job.job_type,
            template_key: tmplKey,
            line_user_id: customer.line_user_id,
            message: body,
            status: r.ok ? "sent" : "failed",
            error: r.ok ? null : r.err,
          } as any);
          if (r.ok) {
            channelUsed = "line";
            console.log(`[LINE] ${job.job_type} → ${customer.line_user_id}`);
          } else {
            lastErr = `line: ${r.err}`;
          }
        }

        // 2) メール（LINE未送信 or LINE失敗 かつ メールあり）
        if (channelUsed === "none" && hasEmail && templateName) {
          const { error: mailErr } = await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName,
              recipientEmail: customer.email,
              idempotencyKey: `${job.job_type}-${job.id}`,
              templateData,
            },
          });
          if (!mailErr) {
            channelUsed = "email";
            console.log(`[EMAIL] ${job.job_type} → ${customer.email}`);
          } else {
            lastErr = `${lastErr ? lastErr + " | " : ""}email: ${mailErr.message || "unknown"}`;
          }
        }

        // 3) SMS（LINEもメールも無理 かつ 電話番号あり）
        if (channelUsed === "none" && hasPhone) {
          // SMSは短く簡潔に
          const smsBody = body.length > 300 ? body.slice(0, 280) + "…" : body;
          const r = await sendSms(customer.phone!, smsBody);
          if (r.ok) {
            channelUsed = "sms";
            console.log(`[SMS] ${job.job_type} → ${customer.phone}`);
          } else if (r.skipped) {
            lastErr = `${lastErr ? lastErr + " | " : ""}sms_skipped: ${r.reason}`;
          } else {
            lastErr = `${lastErr ? lastErr + " | " : ""}sms: ${r.err}`;
          }
        }

        await supabase.from("scheduled_jobs").update({
          status: channelUsed === "none" ? "skipped" : "sent",
          sent_at: new Date().toISOString(),
          error: channelUsed === "none" ? (lastErr || "no_channel_available") : (lastErr || null),
          payload: { ...(job.payload as any || {}), channel_used: channelUsed },
        }).eq("id", job.id);

        // ====== 配信成功時: コミュニケーション履歴を記録（頻度キャップ用） ======
        if (channelUsed !== "none" && job.job_type !== "reminder") {
          await supabase.rpc("record_customer_communication" as any, {
            _customer_id: customer.id,
            _owner_id: job.owner_id,
            _location_id: (job as any).location_id || null,
            _template_key: tmplKey,
            _channel: channelUsed,
          });
        }

        if (channelUsed === "none") failed++; else success++;
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
