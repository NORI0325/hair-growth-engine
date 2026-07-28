// 来店前ブリーフィング: 翌日の予約をスタッフへLINE/メールで通知
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalRequest, withCors } from "../_shared/request-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalRequest(req);
  if (auth instanceof Response) return withCors(auth, corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 明日の日付（JST）
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const tomorrow = new Date(jst.getTime() + 86400 * 1000);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  console.log(`[briefing] target date: ${dateStr}`);

  // 明日の予約を取得（confirmed のみ、staff_idがあるもの）
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(`
      id, owner_id, location_id, staff_id, customer_id, booking_time, menu, menus, total_price, total_duration_minutes, is_nominated, notes,
      customers ( id, full_name, visit_count, total_spent, last_visit_date, line_user_id, email )
    `)
    .eq("booking_date", dateStr)
    .in("status", ["confirmed", "pending"])
    .not("staff_id", "is", null);

  if (error) {
    console.error("[briefing] fetch error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const b of bookings || []) {
    // 重複送信チェック
    const { data: existing } = await supabase
      .from("briefing_logs")
      .select("id")
      .eq("booking_id", b.id)
      .limit(1);
    if (existing && existing.length > 0) { skipped++; continue; }

    // カルテ情報取得
    const { data: chart } = await supabase
      .from("customer_charts")
      .select("*")
      .eq("customer_id", b.customer_id)
      .maybeSingle();

    // 直近の施術履歴
    const { data: lastTreatment } = await supabase
      .from("chart_treatments")
      .select("treatment_date, menu_summary, color_recipe, perm_recipe, next_suggestion, customer_reaction")
      .eq("customer_id", b.customer_id)
      .order("treatment_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    // スタッフ情報
    const { data: staff } = await supabase
      .from("staff")
      .select("name")
      .eq("id", b.staff_id)
      .maybeSingle();

    const c: any = b.customers;
    if (!c) continue;

    // ブリーフィング本文
    const alerts: string[] = [];
    if (chart?.has_diamine_allergy) alerts.push("⚠️ ジアミンアレルギーあり");
    if (chart?.is_pregnant) alerts.push("⚠️ 妊娠中");
    if (chart?.allergies) alerts.push(`⚠️ アレルギー: ${chart.allergies}`);

    const lines: string[] = [];
    lines.push(`【明日のお客様ブリーフィング】`);
    lines.push(``);
    lines.push(`👤 ${c.full_name}様 (${b.is_nominated ? "指名" : "フリー"})`);
    lines.push(`🕐 ${b.booking_time?.slice(0, 5)} / ${b.menu || (b.menus || []).join("・") || "メニュー未設定"}`);
    lines.push(`📊 来店${c.visit_count}回 / 累計¥${(c.total_spent || 0).toLocaleString()}`);
    lines.push(``);
    if (alerts.length) {
      lines.push(`🚨 重要アラート:`);
      alerts.forEach(a => lines.push(`  ${a}`));
      lines.push(``);
    }
    if (chart?.preferred_style) lines.push(`💇 好みスタイル: ${chart.preferred_style}`);
    if (chart?.ng_keywords) lines.push(`❌ NG: ${chart.ng_keywords}`);
    if (chart?.preferred_talk_level !== null && chart?.preferred_talk_level !== undefined) {
      const talk = ["静かに", "あまり話さない", "普通", "たくさん話したい"][chart.preferred_talk_level] || "—";
      lines.push(`💬 トーク: ${talk}`);
    }
    if (lastTreatment) {
      lines.push(``);
      lines.push(`📋 前回 (${lastTreatment.treatment_date}): ${lastTreatment.menu_summary || "—"}`);
      if (lastTreatment.next_suggestion) lines.push(`  → 次回提案: ${lastTreatment.next_suggestion}`);
      const cr = lastTreatment.color_recipe;
      if (Array.isArray(cr) && cr.length > 0) {
        lines.push(`  カラー: ${cr.map((r: any) => `${r.brand || ""}${r.name || ""} ${r.ratio || ""}`).join(" / ")}`);
      }
    }
    if (b.notes) lines.push(`\n📝 予約メモ: ${b.notes}`);

    const message = lines.join("\n");

    // 通知先：profilesのowner_notification_email or LINE通知
    const { data: profile } = await supabase
      .from("profiles")
      .select("owner_notification_email, notification_recipients")
      .eq("id", b.owner_id)
      .maybeSingle();

    let success = false;
    let channel = "email";
    let errorMsg: string | null = null;

    // notification_recipients に明日担当のスタッフ別通知設定があれば優先
    const recipients: any[] = Array.isArray(profile?.notification_recipients) ? profile!.notification_recipients : [];
    const staffSetting = recipients.find((r: any) => r.staff_id === b.staff_id);

    const targetEmail = staffSetting?.email || profile?.owner_notification_email;

    if (targetEmail) {
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            templateName: "booking-alert-owner",
            recipientEmail: targetEmail,
            idempotencyKey: `briefing-${b.id}`,
            templateData: {
              salonName: "明日の予約ブリーフィング",
              ownerName: staff?.name || "スタッフ",
              customerName: c.full_name,
              bookingDate: dateStr,
              bookingTime: b.booking_time?.slice(0, 5) || "",
              menu: b.menu || "",
              notes: message,
            },
          }),
        });
        if (res.ok) success = true;
        else errorMsg = `HTTP ${res.status}`;
      } catch (e: any) {
        errorMsg = e?.message || "send failed";
      }
    } else {
      errorMsg = "no notification email configured";
    }

    // ログ書き込み
    await supabase.from("briefing_logs").insert({
      owner_id: b.owner_id,
      staff_id: b.staff_id,
      booking_id: b.id,
      customer_id: b.customer_id,
      channel,
      status: success ? "sent" : "failed",
      error: errorMsg,
    });

    if (success) sent++; else failed++;
  }

  console.log(`[briefing] sent=${sent} skipped=${skipped} failed=${failed}`);
  return new Response(
    JSON.stringify({ date: dateStr, total: bookings?.length || 0, sent, skipped, failed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
