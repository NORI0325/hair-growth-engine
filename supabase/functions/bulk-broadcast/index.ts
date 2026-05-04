import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";
import { sendSms } from "../_shared/twilio-sms.ts";

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
      .select("id, full_name, email, phone, line_user_id")
      .eq("owner_id", user.id)
      .eq("is_test", false)
      .in("id", customerIds);

    const list = targets || [];
    const isValidLineUserId = (s: string | null) => !!s && /^U[0-9a-f]{32}$/i.test(s);

    const result = {
      total: list.length,
      line: { sent: 0, failed: 0, skipped: 0 },
      sms: { sent: 0, failed: 0, skipped: 0 },
      email: { sent: 0, failed: 0, skipped: 0 },
    };
    const lineLogs: any[] = [];

    for (const c of list) {
      const personalText = message.replace(/\{\{name\}\}/g, c.full_name || "お客様");

      // LINE
      if (useLine) {
        if (!lineToken) {
          result.line.skipped++;
        } else if (!isValidLineUserId(c.line_user_id)) {
          result.line.skipped++;
        } else {
          const r = await sendLinePush(lineToken, c.line_user_id!, personalText);
          if (r.ok) result.line.sent++; else result.line.failed++;
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
          if (r.ok) result.sms.sent++;
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
          if (r.error) result.email.failed++; else result.email.sent++;
        }
      }
    }

    if (lineLogs.length > 0) {
      await supabase.from("line_message_log").insert(lineLogs as any);
    }

    return new Response(JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[bulk-broadcast] error", e);
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
