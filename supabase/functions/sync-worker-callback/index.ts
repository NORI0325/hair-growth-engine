import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";

// 同期失敗時、店舗オーナー/管理者へ即時通知（LINE優先・メールフォールバック）
async function notifySyncFailure(
  supabase: any,
  bookingId: string,
  ownerId: string,
  channel: string,
  errorMessage: string,
) {
  try {
    // 二重通知防止
    const { data: bk } = await supabase
      .from("bookings")
      .select("id, owner_id, location_id, customer_id, booking_date, booking_time, menu, staff_id, salonboard_alert_sent_at")
      .eq("id", bookingId).maybeSingle();
    if (!bk) return { skipped: "booking_not_found" };
    if (bk.salonboard_alert_sent_at) return { skipped: "already_alerted" };

    const [{ data: profile }, { data: customer }, { data: staff }, { data: location }] = await Promise.all([
      supabase.from("profiles").select("salon_name, owner_notification_email, notification_recipients").eq("id", ownerId).maybeSingle(),
      bk.customer_id ? supabase.from("customers").select("full_name, phone").eq("id", bk.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      bk.staff_id ? supabase.from("staff").select("name").eq("id", bk.staff_id).maybeSingle() : Promise.resolve({ data: null }),
      bk.location_id ? supabase.from("locations").select("name").eq("id", bk.location_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const salonName = profile?.salon_name ?? "サロン";
    const customerName = customer?.full_name ?? "お客様";
    const staffName = staff?.name ?? "未割当";
    const locationName = location?.name ?? "本店";
    const bookingDate = bk.booking_date;
    const bookingTime = String(bk.booking_time ?? "").slice(0, 5);
    const menu = bk.menu ?? "-";
    const reviewUrl = `https://saronboost.com/sync-review`;
    const bookingUrl = `https://saronboost.com/bookings`;

    const text =
      `🚨【重要】サロンボード未反映の可能性があります\n\n` +
      `■ 店舗：${locationName}\n` +
      `■ 予約日時：${bookingDate} ${bookingTime}\n` +
      `■ 顧客：${customerName}${customer?.phone ? ` (${customer.phone})` : ""}\n` +
      `■ メニュー：${menu}\n` +
      `■ 担当：${staffName}\n` +
      `■ チャネル：${channel}\n` +
      `■ エラー：${errorMessage}\n\n` +
      `⚠️ 至急サロンボードへ手動登録、または再同期してください。\n` +
      `▶ 未同期予約一覧：${reviewUrl}\n` +
      `▶ 予約管理：${bookingUrl}\n\n— ${salonName}`;

    type Recipient = { name?: string; email?: string; line_user_id?: string; channels?: string[] };
    const recipients: Recipient[] = Array.isArray(profile?.notification_recipients)
      ? (profile!.notification_recipients as Recipient[]) : [];
    const legacyEmail = profile?.owner_notification_email?.trim();
    if (legacyEmail && !recipients.some((r) => r.email?.toLowerCase() === legacyEmail.toLowerCase())) {
      recipients.push({ email: legacyEmail, channels: ["email"] });
    }

    const creds = await getLineCredentials(supabase, ownerId, bk.location_id ?? null);
    const results: string[] = [];
    let anySent = false;

    for (const r of recipients) {
      const channels = r.channels?.length ? r.channels : ["email"];
      // LINE 通知
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
      // メール通知
      if (channels.includes("email") && r.email) {
        try {
          const { error } = await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "booking-alert-owner",
              recipientEmail: r.email,
              idempotencyKey: `sync-fail-${bookingId}-${r.email}`,
              templateData: {
                eventType: "created",
                customerName: `🚨サロンボード未反映 ${customerName}`,
                customerPhone: customer?.phone ?? undefined,
                bookingDate, bookingTime, menu,
                notes: `【同期失敗】チャネル: ${channel}\nエラー: ${errorMessage}\n担当: ${staffName} / 店舗: ${locationName}\n\n至急サロンボードへ手動登録、または再同期してください。\n${reviewUrl}`,
                salonName: profile?.salon_name ?? undefined,
                recipientName: r.name ?? undefined,
              },
            },
          });
          if (!error) anySent = true;
          results.push(`email:${r.email}:${error ? "err" : "sent"}`);
        } catch (e) {
          results.push(`email:err:${(e as Error).message}`);
        }
      }
    }

    if (anySent) {
      await supabase.from("bookings").update({ salonboard_alert_sent_at: new Date().toISOString() }).eq("id", bookingId);
    }

    await supabase.from("sync_logs").insert({
      owner_id: ownerId, reservation_id: bookingId, channel,
      level: anySent ? "warning" : "error",
      message: anySent ? "同期失敗の即時通知を送信" : "同期失敗の即時通知に失敗（受信者未設定または送信エラー）",
      metadata: { results, recipientCount: recipients.length },
    });

    return { sent: anySent, results };
  } catch (e) {
    console.error("[notifySyncFailure] error:", e);
    try {
      await supabase.from("sync_logs").insert({
        owner_id: ownerId, reservation_id: bookingId, channel,
        level: "error", message: "同期失敗通知の処理中に例外発生",
        metadata: { error: (e as Error).message },
      });
    } catch (_) { /* swallow */ }
    return { error: (e as Error).message };
  }
}

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
      try {
        await notifySyncFailure(
          supabase,
          job.reservation_id,
          job.owner_id,
          job.target_channel || "salonboard",
          message || error_type || "unknown_error",
        );
      } catch (e) {
        console.error("[sync-worker-callback] notifySyncFailure threw:", e);
      }
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
