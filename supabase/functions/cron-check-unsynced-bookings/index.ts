// 未同期/同期失敗のLINE予約を毎時チェックし、オーナーへまとめ通知。
// - 対象: source_channel='line', external_source='public_form', booking_date>=today
//         AND (sync_status IN ('failed','pending','pending_sync','needs_review') OR external_reservation_id IS NULL)
// - 通知条件:
//    a) 来店24h以内に failed/pending/needs_review が1件以上 → 即通知（再通知間隔2h）
//    b) 未来予約で未同期が3件以上 → 通知（再通知間隔12h）
//    c) 1時間以上 pending/pending_sync のままなら通知（再通知12h）
//    d) external_reservation_id IS NULL のLINE予約は危険扱い → (a)(b)に含める
// - 二重防止: bookings.salonboard_alert_sent_at を再通知ウィンドウで判定

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";

const RE_ALERT_URGENT_HOURS = 2;   // <24h案件: 2hおき再通知可
const RE_ALERT_NORMAL_HOURS = 12;  // 通常: 12hおき再通知可

function hoursDiff(a: Date, b: Date) { return Math.abs(a.getTime() - b.getTime()) / 36e5; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // 対象予約取得（LINE経由・本日以降・未反映懸念あり）
    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("id, owner_id, location_id, customer_id, staff_id, booking_date, booking_time, menu, sync_status, sync_error_message, external_reservation_id, salonboard_alert_sent_at, updated_at, created_at, source_channel, external_source")
      .eq("source_channel", "line")
      .eq("external_source", "public_form")
      .gte("booking_date", today)
      .or("sync_status.in.(failed,pending,pending_sync,needs_review),external_reservation_id.is.null");

    if (error) throw error;
    const list = bookings ?? [];

    // owner ごとにグループ化
    const byOwner = new Map<string, any[]>();
    for (const b of list) {
      // 既に成功済み (sync_status=success かつ external_reservation_id あり) は除外
      if (b.sync_status === "success" && b.external_reservation_id) continue;
      const arr = byOwner.get(b.owner_id) ?? [];
      arr.push(b);
      byOwner.set(b.owner_id, arr);
    }

    const summary: any[] = [];

    for (const [ownerId, items] of byOwner) {
      // 各予約の重要度 + 再通知判定
      const enriched = items.map((b) => {
        const startAt = new Date(`${b.booking_date}T${String(b.booking_time).slice(0, 8)}+09:00`);
        const hoursUntil = (startAt.getTime() - now.getTime()) / 36e5;
        const isUrgent = hoursUntil >= 0 && hoursUntil <= 24;
        const isPendingStuck =
          (b.sync_status === "pending" || b.sync_status === "pending_sync") &&
          (now.getTime() - new Date(b.created_at).getTime()) / 36e5 >= 1;
        const isFailed = b.sync_status === "failed" || b.sync_status === "needs_review";
        const isMissingExtId = !b.external_reservation_id;
        const lastAlert = b.salonboard_alert_sent_at ? new Date(b.salonboard_alert_sent_at) : null;
        const reAlertWindow = isUrgent ? RE_ALERT_URGENT_HOURS : RE_ALERT_NORMAL_HOURS;
        const canAlert = !lastAlert || hoursDiff(now, lastAlert) >= reAlertWindow;
        return { b, hoursUntil, isUrgent, isPendingStuck, isFailed, isMissingExtId, canAlert, startAt };
      });

      const urgentDanger = enriched.filter((e) => e.isUrgent && (e.isFailed || e.b.sync_status === "pending" || e.b.sync_status === "pending_sync" || e.isMissingExtId));
      const stuckPending = enriched.filter((e) => e.isPendingStuck);
      const futureUnsynced = enriched.filter((e) => !e.isUrgent && (e.isFailed || e.isMissingExtId || e.b.sync_status === "pending" || e.b.sync_status === "pending_sync"));

      const triggers: string[] = [];
      if (urgentDanger.length > 0) triggers.push(`24h以内未反映 ${urgentDanger.length}件`);
      if (futureUnsynced.length >= 3) triggers.push(`未来未反映 ${futureUnsynced.length}件`);
      if (stuckPending.length > 0) triggers.push(`pending停滞 ${stuckPending.length}件`);

      if (triggers.length === 0) {
        summary.push({ ownerId, skipped: "no_trigger", total: items.length });
        continue;
      }

      // 通知対象（再通知可能なもの）
      const alertable = enriched.filter((e) => e.canAlert && (
        (e.isUrgent && (e.isFailed || e.isMissingExtId || e.b.sync_status === "pending" || e.b.sync_status === "pending_sync")) ||
        e.isPendingStuck ||
        (futureUnsynced.length >= 3 && !e.isUrgent)
      ));
      if (alertable.length === 0) {
        summary.push({ ownerId, skipped: "rate_limited", total: items.length });
        continue;
      }

      // 関連メタ取得
      const customerIds = [...new Set(alertable.map((e) => e.b.customer_id).filter(Boolean))];
      const staffIds = [...new Set(alertable.map((e) => e.b.staff_id).filter(Boolean))];
      const locIds = [...new Set(alertable.map((e) => e.b.location_id).filter(Boolean))];
      const [{ data: profile }, { data: customers }, { data: staffs }, { data: locs }] = await Promise.all([
        supabase.from("profiles").select("salon_name, owner_notification_email, notification_recipients").eq("id", ownerId).maybeSingle(),
        customerIds.length ? supabase.from("customers").select("id, full_name, phone").in("id", customerIds) : Promise.resolve({ data: [] }),
        staffIds.length ? supabase.from("staff").select("id, name").in("id", staffIds) : Promise.resolve({ data: [] }),
        locIds.length ? supabase.from("locations").select("id, name").in("id", locIds) : Promise.resolve({ data: [] }),
      ]);
      const cMap = new Map((customers ?? []).map((c: any) => [c.id, c]));
      const sMap = new Map((staffs ?? []).map((s: any) => [s.id, s]));
      const lMap = new Map((locs ?? []).map((l: any) => [l.id, l]));

      // 危険度ソート: urgent > stuck > 失敗 > 未来
      alertable.sort((a, b) => {
        if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
        return a.startAt.getTime() - b.startAt.getTime();
      });
      const top = alertable.slice(0, 5);
      const salonName = (profile as any)?.salon_name ?? "サロン";
      const reviewUrl = "https://saronboost.com/sync-review";

      const lines = top.map((e, i) => {
        const c = cMap.get(e.b.customer_id) as any;
        const s = sMap.get(e.b.staff_id) as any;
        const l = lMap.get(e.b.location_id) as any;
        const t = String(e.b.booking_time).slice(0, 5);
        const tag = e.isUrgent ? "🔴24h以内" : e.isFailed ? "❌失敗" : e.isMissingExtId ? "⚠️未連携" : "⏳停滞";
        return `${i + 1}. ${tag} ${e.b.booking_date} ${t} / ${c?.full_name ?? "顧客"}${c?.phone ? `(${c.phone})` : ""} / ${e.b.menu} / 担当:${s?.name ?? "未割当"} / ${l?.name ?? "本店"} / 状態:${e.b.sync_status}${e.b.sync_error_message ? ` / ${String(e.b.sync_error_message).slice(0, 60)}` : ""}`;
      }).join("\n");

      const text =
        `🚨【重要】サロンボード未反映の予約があります\n\n` +
        `■ サロン：${salonName}\n` +
        `■ 検知件数：${alertable.length}件（${triggers.join(" / ")}）\n` +
        `■ 最も近い来店：${alertable[0].b.booking_date} ${String(alertable[0].b.booking_time).slice(0, 5)}\n\n` +
        `${lines}\n` +
        (alertable.length > 5 ? `\n…ほか${alertable.length - 5}件\n` : "") +
        `\n⚠️ 至急、サロンボードへ手動登録または再同期してください。\n` +
        `▶ 未同期予約一覧：${reviewUrl}\n\n— ${salonName}`;

      // 受信者
      type Recipient = { name?: string; email?: string; line_user_id?: string; channels?: string[] };
      const recipients: Recipient[] = Array.isArray((profile as any)?.notification_recipients)
        ? ((profile as any).notification_recipients as Recipient[]) : [];
      const legacyEmail = (profile as any)?.owner_notification_email?.trim();
      if (legacyEmail && !recipients.some((r) => r.email?.toLowerCase() === legacyEmail.toLowerCase())) {
        recipients.push({ email: legacyEmail, channels: ["email"] });
      }

      const creds = await getLineCredentials(supabase, ownerId, alertable[0].b.location_id ?? null);
      const results: string[] = [];
      let anySent = false;

      for (const r of recipients) {
        const channels = r.channels?.length ? r.channels : ["email"];
        if (channels.includes("line") && r.line_user_id && creds) {
          const lr = await sendLinePush(creds.accessToken, r.line_user_id, text);
          await supabase.from("line_message_log").insert({
            owner_id: ownerId, location_id: alertable[0].b.location_id ?? null,
            line_user_id: r.line_user_id, job_type: "unsynced_alert_cron",
            message: text, status: lr.ok ? "sent" : "failed", error: lr.ok ? null : lr.err,
          });
          if (lr.ok) anySent = true;
          results.push(`line:${r.line_user_id}:${lr.ok ? "sent" : "err"}`);
        }
        if (channels.includes("email") && r.email) {
          try {
            const { error: eErr } = await supabase.functions.invoke("send-transactional-email", {
              body: {
                templateName: "booking-alert-owner",
                recipientEmail: r.email,
                idempotencyKey: `unsynced-cron-${ownerId}-${now.toISOString().slice(0, 13)}`,
                templateData: {
                  eventType: "created",
                  customerName: `🚨未反映予約 ${alertable.length}件`,
                  bookingDate: alertable[0].b.booking_date,
                  bookingTime: String(alertable[0].b.booking_time).slice(0, 5),
                  menu: "（複数）",
                  notes: `${triggers.join(" / ")}\n\n${lines}\n\n${reviewUrl}`,
                  salonName,
                  recipientName: r.name ?? undefined,
                },
              },
            });
            if (!eErr) anySent = true;
            results.push(`email:${r.email}:${eErr ? "err" : "sent"}`);
          } catch (e) {
            results.push(`email:err:${(e as Error).message}`);
          }
        }
      }

      // 通知済みフラグ更新
      if (anySent) {
        const ids = alertable.map((e) => e.b.id);
        await supabase.from("bookings").update({ salonboard_alert_sent_at: now.toISOString() }).in("id", ids);
      }

      await supabase.from("sync_logs").insert({
        owner_id: ownerId, channel: "salonboard",
        level: anySent ? "warning" : "error",
        message: anySent ? `[cron] 未反映予約まとめ通知 ${alertable.length}件` : `[cron] 未反映予約検知したが送信失敗`,
        metadata: { triggers, total: items.length, alerted: alertable.length, results },
      });

      summary.push({ ownerId, alerted: alertable.length, total: items.length, triggers, anySent });
    }

    return new Response(JSON.stringify({ ok: true, owners: byOwner.size, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[cron-check-unsynced-bookings]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
