import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";
import { sendTransactionalEmailInternal } from "../_shared/invoke-internal.ts";

// 同期失敗時、店舗オーナー/管理者へ即時通知（LINE優先・メールフォールバック）
// 二重通知防止: bookings.salonboard_alert_sent_at
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { bookingId, ownerId, channel, errorMessage } = await req.json();
    if (!bookingId || !ownerId) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: bk } = await supabase
      .from("bookings")
      .select("id, owner_id, location_id, customer_id, booking_date, booking_time, menu, staff_id, salonboard_alert_sent_at")
      .eq("id", bookingId).maybeSingle();
    if (!bk) {
      return new Response(JSON.stringify({ skipped: "booking_not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (bk.salonboard_alert_sent_at) {
      return new Response(JSON.stringify({ skipped: "already_alerted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: profile }, { data: customer }, { data: staff }, { data: location }] = await Promise.all([
      supabase.from("profiles").select("salon_name, owner_notification_email, notification_recipients").eq("id", ownerId).maybeSingle(),
      bk.customer_id ? supabase.from("customers").select("full_name, phone").eq("id", bk.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      bk.staff_id ? supabase.from("staff").select("name").eq("id", bk.staff_id).maybeSingle() : Promise.resolve({ data: null }),
      bk.location_id ? supabase.from("locations").select("name").eq("id", bk.location_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const salonName = profile?.salon_name ?? "サロン";
    const customerName = (customer as any)?.full_name ?? "お客様";
    const customerPhone = (customer as any)?.phone ?? null;
    const staffName = (staff as any)?.name ?? "未割当";
    const locationName = (location as any)?.name ?? "本店";
    const bookingDate = bk.booking_date;
    const bookingTime = String(bk.booking_time ?? "").slice(0, 5);
    const menu = bk.menu ?? "-";
    const ch = channel || "salonboard";
    const errMsg = errorMessage || "unknown_error";
    const reviewUrl = `https://saronboost.com/sync-review`;
    const bookingUrl = `https://saronboost.com/bookings`;

    const text =
      `🚨【重要】サロンボード未反映の可能性があります\n\n` +
      `■ 店舗：${locationName}\n` +
      `■ 予約日時：${bookingDate} ${bookingTime}\n` +
      `■ 顧客：${customerName}${customerPhone ? ` (${customerPhone})` : ""}\n` +
      `■ メニュー：${menu}\n` +
      `■ 担当：${staffName}\n` +
      `■ チャネル：${ch}\n` +
      `■ エラー：${errMsg}\n\n` +
      `⚠️ 至急サロンボードへ手動登録、または再同期してください。\n` +
      `▶ 未同期予約一覧：${reviewUrl}\n` +
      `▶ 予約管理：${bookingUrl}\n\n— ${salonName}`;

    type Recipient = { name?: string; email?: string; line_user_id?: string; channels?: string[] };
    const recipients: Recipient[] = Array.isArray((profile as any)?.notification_recipients)
      ? ((profile as any).notification_recipients as Recipient[]) : [];
    const legacyEmail = (profile as any)?.owner_notification_email?.trim();
    if (legacyEmail && !recipients.some((r) => r.email?.toLowerCase() === legacyEmail.toLowerCase())) {
      recipients.push({ email: legacyEmail, channels: ["email"] });
    }

    const creds = await getLineCredentials(supabase, ownerId, bk.location_id ?? null);
    const results: string[] = [];
    let anySent = false;

    for (const r of recipients) {
      const channels = r.channels?.length ? r.channels : ["email"];
      if (channels.includes("line") && r.line_user_id && creds) {
        try {
          const lr = await sendLinePush(creds.accessToken, r.line_user_id, text);
          await supabase.from("line_message_log").insert({
            owner_id: ownerId, location_id: bk.location_id ?? null, line_user_id: r.line_user_id,
            job_type: "sync_failure_alert", message: text,
            status: lr.ok ? "sent" : "failed", error: lr.ok ? null : lr.err,
          });
          if (lr.ok) anySent = true;
          results.push(`line:${r.line_user_id}:${lr.ok ? "sent" : "err"}`);
        } catch (e) {
          results.push(`line:err:${(e as Error).message}`);
        }
      }
      if (channels.includes("email") && r.email) {
        try {
          const er = await sendTransactionalEmailInternal({
            templateName: "booking-alert-owner",
            recipientEmail: r.email,
            idempotencyKey: `sync-fail-${bookingId}-${r.email}`,
            templateData: {
              eventType: "created",
              customerName: `🚨サロンボード未反映 ${customerName}`,
              customerPhone: customerPhone ?? undefined,
              bookingDate, bookingTime, menu,
              notes: `【同期失敗】チャネル: ${ch}\nエラー: ${errMsg}\n担当: ${staffName} / 店舗: ${locationName}\n\n至急サロンボードへ手動登録、または再同期してください。\n${reviewUrl}`,
              salonName,
              recipientName: r.name ?? undefined,
            },
          });
          if (er.ok) {
            anySent = true;
            results.push(`email:${r.email}:sent`);
          } else {
            results.push(`email:${r.email}:err:${er.status}:${(er.errorBody ?? er.errorMessage ?? "").slice(0, 200)}`);
          }
        } catch (e) {
          results.push(`email:${r.email}:err:exception:${(e as Error).message}`);
        }
      }
    }

    if (anySent) {
      await supabase.from("bookings").update({ salonboard_alert_sent_at: new Date().toISOString() }).eq("id", bookingId);
    }

    await supabase.from("sync_logs").insert({
      owner_id: ownerId, reservation_id: bookingId, channel: ch,
      level: anySent ? "warning" : "error",
      message: anySent ? "同期失敗の即時通知を送信" : "同期失敗の即時通知に失敗（受信者未設定または送信エラー）",
      metadata: { results, recipientCount: recipients.length },
    });

    return new Response(JSON.stringify({ sent: anySent, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[notify-sync-failure] error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
