import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";
import { sendSms } from "../_shared/twilio-sms.ts";
import { applySegmentFilter, buildFilterContext, ageGroupOf, type SegmentInput } from "../_shared/segment-filter.ts";

const nextSuggestedMenu = (lastMenu: string | null): string => {
  const m = (lastMenu || "").toLowerCase();
  if (/カラー|color/.test(m)) return "リタッチカラー＋トリートメント";
  if (/パーマ|perm/.test(m)) return "パーマメンテナンス＋トリートメント";
  if (/縮毛|矯正/.test(m)) return "前髪縮毛矯正＋カット";
  if (/カット|cut/.test(m)) return "カット＋カラー";
  if (/スパ|spa|トリート/.test(m)) return "ヘッドスパ＋トリートメント";
  return "カット＋カラー";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ success: false, message: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ success: false, message: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const message: string = (body?.message || "").toString().trim();
    const subject: string = (body?.subject || "サロンからのお知らせ").toString().trim();
    const customerIds: string[] = Array.isArray(body?.customer_ids)
      ? body.customer_ids.filter((x: any) => typeof x === "string") : [];
    const channels: string[] = Array.isArray(body?.channels) ? body.channels : [];
    const useLine = channels.includes("line");
    const useSms = channels.includes("sms");
    const useEmail = channels.includes("email");
    const skipRecentDays: number = Number.isFinite(Number(body?.skip_recent_days)) && Number(body?.skip_recent_days) > 0
      ? Math.min(90, Math.floor(Number(body.skip_recent_days))) : 0;
    const excludeRecentBookingDays: number = Number.isFinite(Number(body?.exclude_recent_booking_days)) && Number(body?.exclude_recent_booking_days) > 0
      ? Math.min(90, Math.floor(Number(body.exclude_recent_booking_days))) : 0;

    const seg: SegmentInput = (body?.segment || {}) as SegmentInput;

    if (!message || message.length < 2) {
      return new Response(JSON.stringify({ success: false, message: "メッセージを入力してください" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!useLine && !useSms && !useEmail) {
      return new Response(JSON.stringify({ success: false, message: "送信チャネルを1つ以上選択してください" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (customerIds.length === 0) {
      return new Response(JSON.stringify({ success: false, message: "送信対象が選択されていません" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("line_channel_access_token, salon_name")
      .eq("id", user.id)
      .maybeSingle();
    const lineToken = (profile as any)?.line_channel_access_token;
    const salonName = (profile as any)?.salon_name || "サロン";

    const { data: targets } = await supabase.from("customers")
      .select("id, full_name, email, phone, line_user_id, birthday, gender, last_visit_date, visit_count, total_spent")
      .eq("owner_id", user.id)
      .eq("is_test", false)
      .in("id", customerIds);

    const allCustomers = (targets || []) as any[];

    // 補助データ取得
    const ctx = await buildFilterContext(supabase, user.id, allCustomers.map(c => c.id), excludeRecentBookingDays);

    // セグメントフィルタ適用
    const { matched: list, segmentSkipped, recentBookingSkipped } = applySegmentFilter(allCustomers, seg, ctx);

    const isValidLineUserId = (s: string | null) => !!s && /^U[0-9a-f]{32}$/i.test(s);

    // クールダウン
    let cooldownSkipped = 0;
    let finalList = list;
    if (skipRecentDays > 0 && finalList.length > 0) {
      const cutoff = new Date(Date.now() - skipRecentDays * 86400000).toISOString();
      const { data: states } = await supabase
        .from("customer_communication_state")
        .select("customer_id, last_sent_at")
        .eq("owner_id", user.id)
        .in("customer_id", finalList.map((c: any) => c.id))
        .gte("last_sent_at", cutoff);
      const recentSet = new Set((states || []).map((s: any) => s.customer_id));
      const before = finalList.length;
      finalList = finalList.filter((c: any) => !recentSet.has(c.id));
      cooldownSkipped = before - finalList.length;
    }

    // スタッフ名解決（パーソナライズ用）
    const staffIds = new Set<string>();
    for (const c of finalList) {
      const sid = ctx.lastStaffId[c.id];
      if (sid) staffIds.add(sid);
    }
    const staffNames: Record<string, string> = {};
    if (staffIds.size > 0) {
      const { data: staff } = await supabase.from("staff").select("id, name").in("id", Array.from(staffIds));
      for (const s of staff || []) staffNames[s.id] = s.name;
    }

    const result = {
      total: finalList.length,
      segment_skipped: segmentSkipped,
      recent_booking_skipped: recentBookingSkipped,
      cooldown_skipped: cooldownSkipped,
      line: { sent: 0, failed: 0, skipped: 0 },
      sms: { sent: 0, failed: 0, skipped: 0 },
      email: { sent: 0, failed: 0, skipped: 0 },
    };
    const lineLogs: any[] = [];
    const stateUpserts: any[] = [];

    const personalize = (tpl: string, c: any): string => {
      const lastMenu = ctx.lastMenu[c.id] || "前回のメニュー";
      const sid = ctx.lastStaffId[c.id];
      const staff = sid ? (staffNames[sid] || "担当スタッフ") : "担当スタッフ";
      const ds = c.last_visit_date ? Math.floor((Date.now() - new Date(c.last_visit_date).getTime()) / 86400000) : null;
      const daysSinceText = ds === null ? "" : `${ds}日`;
      const next = nextSuggestedMenu(ctx.lastMenu[c.id]);
      return tpl
        .replace(/\{\{name\}\}/g, c.full_name || "お客様")
        .replace(/\{\{last_menu\}\}/g, lastMenu)
        .replace(/\{\{staff_name\}\}/g, staff)
        .replace(/\{\{days_since\}\}/g, daysSinceText)
        .replace(/\{\{next_suggested_menu\}\}/g, next)
        .replace(/\{\{salon_name\}\}/g, salonName);
    };

    for (const c of finalList) {
      const personalText = personalize(message, c);
      let anySent = false;
      let lastChannel: string | null = null;

      if (useLine) {
        if (!lineToken) result.line.skipped++;
        else if (!isValidLineUserId(c.line_user_id)) result.line.skipped++;
        else {
          const r = await sendLinePush(lineToken, c.line_user_id!, personalText);
          if (r.ok) { result.line.sent++; anySent = true; lastChannel = "line"; }
          else result.line.failed++;
          lineLogs.push({
            owner_id: user.id, customer_id: c.id, job_type: "broadcast",
            line_user_id: c.line_user_id, message: personalText,
            status: r.ok ? "sent" : "failed", error: r.ok ? null : r.err,
          });
          await new Promise(res => setTimeout(res, 60));
        }
      }

      if (useSms) {
        if (!c.phone) result.sms.skipped++;
        else {
          const r = await sendSms(c.phone, personalText);
          if (r.ok) { result.sms.sent++; anySent = true; lastChannel = "sms"; }
          else if (r.skipped) result.sms.skipped++;
          else result.sms.failed++;
          await new Promise(res => setTimeout(res, 80));
        }
      }

      if (useEmail) {
        if (!c.email) result.email.skipped++;
        else {
          const r = await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "campaign-news",
              recipientEmail: c.email,
              idempotencyKey: `bulk-${Date.now()}-${c.id}`,
              templateData: {
                customerName: c.full_name || "お客様",
                salonName,
                subject,
                bodyText: personalText,
              },
            },
          });
          if (r.error) result.email.failed++;
          else { result.email.sent++; anySent = true; lastChannel = "email"; }
        }
      }

      if (anySent) {
        stateUpserts.push({
          owner_id: user.id,
          customer_id: c.id,
          last_sent_at: new Date().toISOString(),
          last_channel: lastChannel,
          last_template_key: "bulk-broadcast",
        });
      }
    }

    if (lineLogs.length > 0) {
      await supabase.from("line_message_log").insert(lineLogs as any);
    }
    if (stateUpserts.length > 0) {
      await supabase.from("customer_communication_state")
        .upsert(stateUpserts as any, { onConflict: "customer_id" });
    }

    return new Response(JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[bulk-broadcast] error", e);
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
