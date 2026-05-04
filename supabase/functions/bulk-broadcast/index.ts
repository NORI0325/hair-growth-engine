import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";
import { sendSms } from "../_shared/twilio-sms.ts";

// 年代計算
const ageGroupOf = (birthday: string | null): string | null => {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  if (age < 20) return "teens";
  if (age < 30) return "20s";
  if (age < 40) return "30s";
  if (age < 50) return "40s";
  if (age < 60) return "50s";
  return "60s+";
};

// 次回提案メニュー（簡易ロジック）
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

    // セグメント絞り込み（性別/年代/最終来店日数/VIP/前回メニューキーワード）
    const segGenders: string[] = Array.isArray(body?.segment?.genders) ? body.segment.genders : [];
    const segAges: string[] = Array.isArray(body?.segment?.age_groups) ? body.segment.age_groups : [];
    const segDaysMin: number | null = Number.isFinite(Number(body?.segment?.days_since_min)) ? Number(body.segment.days_since_min) : null;
    const segDaysMax: number | null = Number.isFinite(Number(body?.segment?.days_since_max)) ? Number(body.segment.days_since_max) : null;
    const segVipOnly: boolean = !!body?.segment?.vip_only;
    const segMenuKeyword: string = (body?.segment?.menu_keyword || "").toString().trim().toLowerCase();

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

    let list = (targets || []) as any[];

    // 各顧客の最新トリートメント・スタッフ取得
    const ids = list.map((c) => c.id);
    let lastTreatmentMap: Record<string, { menu: string | null; staff_name: string | null }> = {};
    if (ids.length > 0) {
      const { data: treats } = await supabase
        .from("chart_treatments")
        .select("customer_id, menu_summary, staff_id, treatment_date")
        .eq("owner_id", user.id)
        .in("customer_id", ids)
        .order("treatment_date", { ascending: false });
      const seen = new Set<string>();
      const staffIds = new Set<string>();
      const tmpMap: Record<string, { menu: string | null; staff_id: string | null }> = {};
      for (const t of treats || []) {
        if (seen.has(t.customer_id)) continue;
        seen.add(t.customer_id);
        tmpMap[t.customer_id] = { menu: t.menu_summary, staff_id: t.staff_id };
        if (t.staff_id) staffIds.add(t.staff_id);
      }
      let staffNames: Record<string, string> = {};
      if (staffIds.size > 0) {
        const { data: staff } = await supabase.from("staff").select("id, name").in("id", Array.from(staffIds));
        for (const s of staff || []) staffNames[s.id] = s.name;
      }
      for (const [cid, v] of Object.entries(tmpMap)) {
        lastTreatmentMap[cid] = { menu: v.menu, staff_name: v.staff_id ? (staffNames[v.staff_id] || null) : null };
      }
    }

    // セグメントフィルタ適用
    const isVip = (c: any) => (c.total_spent || 0) >= 150000 || (c.visit_count || 0) >= 15;
    const daysSince = (c: any) => c.last_visit_date ? Math.floor((Date.now() - new Date(c.last_visit_date).getTime()) / 86400000) : null;

    let segmentSkipped = 0;
    const beforeSeg = list.length;
    list = list.filter((c) => {
      if (segGenders.length > 0 && !segGenders.includes(c.gender || "unknown")) return false;
      if (segAges.length > 0) {
        const ag = ageGroupOf(c.birthday);
        if (!ag || !segAges.includes(ag)) return false;
      }
      const ds = daysSince(c);
      if (segDaysMin !== null && (ds === null || ds < segDaysMin)) return false;
      if (segDaysMax !== null && (ds === null || ds > segDaysMax)) return false;
      if (segVipOnly && !isVip(c)) return false;
      if (segMenuKeyword) {
        const m = (lastTreatmentMap[c.id]?.menu || "").toLowerCase();
        if (!m.includes(segMenuKeyword)) return false;
      }
      return true;
    });
    segmentSkipped = beforeSeg - list.length;

    const isValidLineUserId = (s: string | null) => !!s && /^U[0-9a-f]{32}$/i.test(s);

    // クールダウン: N日以内に何らかの配信実績がある顧客をスキップ
    let cooldownSkipped = 0;
    if (skipRecentDays > 0 && list.length > 0) {
      const cutoff = new Date(Date.now() - skipRecentDays * 86400000).toISOString();
      const { data: states } = await supabase
        .from("customer_communication_state")
        .select("customer_id, last_sent_at")
        .eq("owner_id", user.id)
        .in("customer_id", list.map((c: any) => c.id))
        .gte("last_sent_at", cutoff);
      const recentSet = new Set((states || []).map((s: any) => s.customer_id));
      const before = list.length;
      list = list.filter((c: any) => !recentSet.has(c.id));
      cooldownSkipped = before - list.length;
    }

    const result = {
      total: list.length,
      segment_skipped: segmentSkipped,
      cooldown_skipped: cooldownSkipped,
      line: { sent: 0, failed: 0, skipped: 0 },
      sms: { sent: 0, failed: 0, skipped: 0 },
      email: { sent: 0, failed: 0, skipped: 0 },
    };
    const lineLogs: any[] = [];
    const stateUpserts: any[] = [];

    const personalize = (tpl: string, c: any): string => {
      const lt = lastTreatmentMap[c.id];
      const lastMenu = lt?.menu || "前回のメニュー";
      const staff = lt?.staff_name || "担当スタッフ";
      const ds = daysSince(c);
      const daysSinceText = ds === null ? "" : `${ds}日`;
      const next = nextSuggestedMenu(lt?.menu);
      return tpl
        .replace(/\{\{name\}\}/g, c.full_name || "お客様")
        .replace(/\{\{last_menu\}\}/g, lastMenu)
        .replace(/\{\{staff_name\}\}/g, staff)
        .replace(/\{\{days_since\}\}/g, daysSinceText)
        .replace(/\{\{next_suggested_menu\}\}/g, next)
        .replace(/\{\{salon_name\}\}/g, salonName);
    };

    for (const c of list) {
      const personalText = personalize(message, c);
      let anySent = false;
      let lastChannel: string | null = null;

      // LINE
      if (useLine) {
        if (!lineToken) {
          result.line.skipped++;
        } else if (!isValidLineUserId(c.line_user_id)) {
          result.line.skipped++;
        } else {
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

      // SMS
      if (useSms) {
        if (!c.phone) { result.sms.skipped++; }
        else {
          const r = await sendSms(c.phone, personalText);
          if (r.ok) { result.sms.sent++; anySent = true; lastChannel = "sms"; }
          else if (r.skipped) result.sms.skipped++;
          else result.sms.failed++;
          await new Promise(res => setTimeout(res, 80));
        }
      }

      // Email (transactional経由)
      if (useEmail) {
        if (!c.email) { result.email.skipped++; }
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
