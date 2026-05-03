import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";

// 公開：予約変更（新規/更新/キャンセル）時にオーナー＋お客様へ通知
//  - オーナー: メール（owner_notification_email）
//  - お客様 : LINE連携済みなら LINE プッシュ、メール登録があればメール
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // テスト送信モード：DBを参照せずダミーデータでメールだけ送る
    if (body?.test === true) {
      const recipient = body.recipientEmail;
      if (!recipient) {
        return new Response(JSON.stringify({ error: "no_recipient" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "booking-alert-owner",
          recipientEmail: recipient,
          idempotencyKey: `owner-alert-test-${Date.now()}`,
          templateData: {
            eventType: "created",
            customerName: "テスト 太郎",
            customerPhone: "090-0000-0000",
            bookingDate: new Date().toISOString().slice(0, 10),
            bookingTime: "14:00",
            menu: "カット＋カラー（テスト送信）",
            notes: "これはテスト送信です。実際の予約は入っていません。",
            salonName: body.salonName ?? undefined,
          },
        },
      });
      if (error) {
        console.error("test send error:", error);
        return new Response(JSON.stringify({ error: "send_failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, test: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bookingId, eventType, ownerId: bodyOwnerId, payload } = body;

    // === 特殊イベント: cancel_needs_review (キャンセルメールが届いたが該当予約特定不能) ===
    if (eventType === "cancel_needs_review") {
      const ownerId = bodyOwnerId;
      if (!ownerId) {
        return new Response(JSON.stringify({ error: "missing_owner_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("salon_name, owner_notification_email, line_channel_access_token, notification_recipients")
        .eq("id", ownerId).maybeSingle();
      const salonName = prof?.salon_name ?? "サロン";
      const msg =
        `⚠️ 要確認: キャンセルメールを受信しましたが、該当する予約を自動特定できませんでした。\n\n` +
        `👤 ${payload?.customer_name ?? "(名前不明)"}\n` +
        `📅 ${payload?.booking_date ?? "?"} ${payload?.booking_time ?? ""}\n` +
        `🆔 ${payload?.external_reservation_id ?? "?"}\n\n` +
        `管理画面の「受信ログ」から内容を確認し、該当予約を手動でキャンセルしてください。\n— ${salonName}`;

      const recips: any[] = Array.isArray(prof?.notification_recipients) ? prof!.notification_recipients : [];
      const results: string[] = [];
      for (const r of recips) {
        const channels = r.channels?.length ? r.channels : ["email"];
        if (channels.includes("line") && r.line_user_id && prof?.line_channel_access_token) {
          const lr = await sendLinePush(prof.line_channel_access_token, r.line_user_id, msg);
          await supabase.from("line_message_log").insert({
            owner_id: ownerId, line_user_id: r.line_user_id,
            job_type: "cancel_needs_review", message: msg,
            status: lr.ok ? "sent" : "failed", error: lr.ok ? null : lr.err,
          });
          results.push(`line:${r.line_user_id}:${lr.ok ? "sent" : "err"}`);
        }
        if (channels.includes("email") && r.email) {
          // シンプルにbooking-alert-ownerテンプレを流用（notes欄に警告内容）
          await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "booking-alert-owner",
              recipientEmail: r.email,
              idempotencyKey: `cancel-review-${payload?.log_id ?? Date.now()}-${r.email}`,
              templateData: {
                eventType: "cancelled",
                customerName: `⚠️要確認 ${payload?.customer_name ?? ""}`,
                bookingDate: payload?.booking_date ?? "-",
                bookingTime: payload?.booking_time ?? "-",
                menu: "(キャンセルメール受信・該当予約特定不能)",
                notes: `外部ID: ${payload?.external_reservation_id ?? "?"}\n受信ログから手動確認をお願いします。`,
                salonName,
              },
            },
          });
          results.push(`email:${r.email}:sent`);
        }
      }
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!bookingId || !["created", "updated", "cancelled", "cancelled_by_customer"].includes(eventType)) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, owner_id, booking_date, booking_time, menu, notes, customer_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) {
      return new Response(JSON.stringify({ error: "booking_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: profile }, { data: customer }] = await Promise.all([
      supabase
        .from("profiles")
        .select("salon_name, owner_notification_email, line_channel_access_token, notification_recipients")
        .eq("id", booking.owner_id)
        .maybeSingle(),
      supabase
        .from("customers")
        .select("full_name, phone, email, line_user_id")
        .eq("id", booking.customer_id)
        .maybeSingle(),
    ]);

    const salonName = profile?.salon_name ?? "サロン";
    const bookingDate = booking.booking_date;
    const bookingTime = String(booking.booking_time).slice(0, 5);
    const menu = booking.menu;
    const customerName = customer?.full_name ?? "お客様";

    const eventLabel =
      eventType === "created" ? "ご予約承りました"
        : eventType === "updated" ? "ご予約内容を変更しました"
          : eventType === "cancelled_by_customer" ? "🆘 お客様がオンラインからキャンセルされました"
            : "ご予約をキャンセルしました";

    const results: Record<string, unknown> = {};

    // === ① オーナー側へ通知（複数宛先 + メール/LINE）===
    type Recipient = { name?: string; email?: string; line_user_id?: string; channels?: string[] };
    const recipients: Recipient[] = Array.isArray(profile?.notification_recipients)
      ? (profile!.notification_recipients as Recipient[])
      : [];

    // 後方互換: owner_notification_email が設定済みでリストに無ければ追加
    const legacyEmail = profile?.owner_notification_email?.trim();
    if (legacyEmail && !recipients.some((r) => r.email?.toLowerCase() === legacyEmail.toLowerCase())) {
      recipients.push({ email: legacyEmail, channels: ["email"] });
    }

    const ownerEmailResults: string[] = [];
    const ownerLineResults: string[] = [];

    for (const r of recipients) {
      const channels = r.channels?.length ? r.channels : ["email"];

      // メール通知
      if (channels.includes("email") && r.email) {
        const { error } = await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "booking-alert-owner",
            recipientEmail: r.email,
            idempotencyKey: `owner-alert-${eventType}-${bookingId}-${r.email}`,
            templateData: {
              eventType,
              customerName,
              customerPhone: customer?.phone ?? undefined,
              bookingDate,
              bookingTime,
              menu,
              notes: booking.notes ?? undefined,
              salonName: profile?.salon_name ?? undefined,
              recipientName: r.name ?? undefined,
            },
          },
        });
        ownerEmailResults.push(error ? `${r.email}: error` : `${r.email}: sent`);
        if (error) console.error("owner email error:", r.email, error);
      }

      // LINE通知（オーナー/スタッフのLINE）
      if (channels.includes("line") && r.line_user_id && profile?.line_channel_access_token) {
        const lineMsg =
          `🔔 ${eventLabel}\n\n` +
          `👤 ${customerName}様\n` +
          `📅 ${bookingDate} ${bookingTime}\n` +
          `💇 ${menu}\n` +
          (customer?.phone ? `📞 ${customer.phone}\n` : "") +
          (booking.notes ? `📝 ${booking.notes}\n` : "") +
          `\n— ${salonName}`;
        const lr = await sendLinePush(profile.line_channel_access_token, r.line_user_id, lineMsg);
        ownerLineResults.push(lr.ok ? `${r.line_user_id}: sent` : `${r.line_user_id}: error`);
        await supabase.from("line_message_log").insert({
          owner_id: booking.owner_id,
          line_user_id: r.line_user_id,
          job_type: `owner_alert_${eventType}`,
          message: lineMsg,
          status: lr.ok ? "sent" : "failed",
          error: lr.ok ? null : lr.err,
        });
      }
    }

    results.owner_email = ownerEmailResults.length ? ownerEmailResults : "skipped: no email recipient";
    results.owner_line = ownerLineResults.length ? ownerLineResults : "skipped: no line recipient";

    // === ② お客様へ LINE プッシュ（連携済みなら）===
    if (customer?.line_user_id && profile?.line_channel_access_token) {
      const lineMsg =
        `🌸 ${customerName}様\n\n${eventLabel}。\n\n` +
        `📅 ${bookingDate}\n⏰ ${bookingTime}\n💇 ${menu}\n\n` +
        (eventType === "cancelled"
          ? `またのご利用を心よりお待ちしております。\n\n— ${salonName}`
          : `当日のご来店を心よりお待ちしております。\nご変更・キャンセルはトーク下部の「予約する」ボタンよりお願いいたします。\n\n— ${salonName}`);
      const r = await sendLinePush(profile.line_channel_access_token, customer.line_user_id, lineMsg);
      results.customer_line = r.ok ? "sent" : `error: ${r.err}`;
      // ログ記録
      await supabase.from("line_message_log").insert({
        owner_id: booking.owner_id,
        customer_id: booking.customer_id,
        line_user_id: customer.line_user_id,
        job_type: `booking_${eventType}`,
        message: lineMsg,
        status: r.ok ? "sent" : "failed",
        error: r.ok ? null : r.err,
      });
    } else {
      results.customer_line = "skipped: not linked";
    }

    // === ③ お客様へメール（メール登録があれば）===
    if (customer?.email) {
      const templateName =
        eventType === "cancelled" || eventType === "cancelled_by_customer" ? "booking-cancelled"
          : eventType === "updated" ? "booking-updated"
            : "booking-confirmation";
      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName,
          recipientEmail: customer.email,
          idempotencyKey: `customer-${eventType}-${bookingId}`,
          templateData: {
            customerName,
            salonName,
            bookingDate,
            bookingTime,
            menu,
          },
        },
      });
      results.customer_email = error ? `error: ${error.message}` : "sent";
      if (error) console.error("customer email error:", error);
    } else {
      results.customer_email = "skipped: no email";
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("notify-owner-booking error:", e);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
