import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getLineCredentials } from "../_shared/line-push.ts";
import { sendTransactionalEmailInternal } from "../_shared/invoke-internal.ts";

// オリジン取得（公開URL or Lovable preview）
const getAppOrigin = (req: Request): string => {
  const origin = req.headers.get("origin") || req.headers.get("referer");
  if (origin) {
    try { return new URL(origin).origin; } catch {}
  }
  return "https://app.lovable.dev";
};

const renderTemplate = (template: string, vars: Record<string, string>) => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || "");
};

// Twilio SMS送信
const sendSMS = async (to: string, body: string): Promise<{ ok: boolean; error?: string }> => {
  const apiKey = Deno.env.get("TWILIO_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey || !lovableKey) return { ok: false, error: "SMS not configured" };

  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!fromNumber) return { ok: false, error: "TWILIO_FROM_NUMBER not set" };

  try {
    const res = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: JSON.stringify(data) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
};

// LINE Push送信
const sendLine = async (token: string, userId: string, text: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `LINE ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ユーザー検証
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  try {
    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id required" }), { status: 400, headers: corsHeaders });
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404, headers: corsHeaders });
    }

    // セグメントに該当する顧客を取得
    let q = supabase.from("customers").select("id, full_name, email, phone, last_visit_date, line_user_id, location_id").eq("owner_id", user.id);
    if ((campaign as any).location_id) q = q.eq("location_id", (campaign as any).location_id);

    const today = new Date();
    if (campaign.target_segment === "dormant") {
      const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 180);
      q = q.lt("last_visit_date", cutoff.toISOString().split("T")[0]);
    } else if (campaign.target_segment === "at_risk") {
      const c1 = new Date(today); c1.setDate(c1.getDate() - 180);
      const c2 = new Date(today); c2.setDate(c2.getDate() - 90);
      q = q.gte("last_visit_date", c1.toISOString().split("T")[0]).lt("last_visit_date", c2.toISOString().split("T")[0]);
    } else if (campaign.target_segment === "active") {
      const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 90);
      q = q.gte("last_visit_date", cutoff.toISOString().split("T")[0]);
    }

    const { data: customers } = await q.limit(2000);
    if (!customers || customers.length === 0) {
      await supabase.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString(), total_recipients: 0 }).eq("id", campaign_id);
      return new Response(JSON.stringify({ success: true, recipients: 0 }), { headers: corsHeaders });
    }

    // ステータス更新
    await supabase.from("campaigns").update({ status: "sending", total_recipients: customers.length }).eq("id", campaign_id);

    // ownerProfile（salon_name用）
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("salon_name")
      .eq("id", user.id)
      .maybeSingle();

    // 各顧客にbooking_tokenを取得して配信
    const { data: tokens } = await supabase
      .from("booking_tokens")
      .select("customer_id, token")
      .in("customer_id", customers.map(c => c.id));

    const tokenMap = new Map(tokens?.map(t => [t.customer_id, t.token]) || []);
    const origin = getAppOrigin(req);

    const sends: any[] = [];
    let smsSuccess = 0, smsFailed = 0, emailSuccess = 0;

    for (const c of customers) {
      const token = tokenMap.get(c.id);
      if (!token) continue;
      const bookingLink = `${origin}/book/${token}`;

      const vars = {
        name: c.full_name,
        booking_link: bookingLink,
      };

      const send: any = {
        campaign_id,
        customer_id: c.id,
        email_sent: false,
        sms_sent: false,
      };

      // メール（送信キュー経由で実配信）
      if (campaign.send_email && c.email) {
        const r = await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "thank-you",
            recipientEmail: c.email,
            idempotencyKey: `campaign-${campaign_id}-${c.id}`,
            templateData: {
              customerName: c.full_name,
              salonName: ownerProfile?.salon_name || "サロン",
              bookingLink,
            },
          },
        });
        if (!r.error) { send.email_sent = true; emailSuccess++; }
      }

      // SMS
      if (campaign.send_sms && c.phone && campaign.sms_body) {
        const smsBody = renderTemplate(campaign.sms_body, vars);
        const result = await sendSMS(c.phone, smsBody);
        if (result.ok) {
          send.sms_sent = true;
          smsSuccess++;
        } else {
          send.sms_error = result.error;
          smsFailed++;
        }
        await new Promise(r => setTimeout(r, 100));
      }

      // LINE Push（顧客にLINE ID登録があり、店舗別または共通トークンがあれば）
      if (c.line_user_id) {
        const custLocId = (c as any).location_id || (campaign as any).location_id || null;
        const creds = await getLineCredentials(supabase, user.id, custLocId);
        if (creds) {
          const lineBody = renderTemplate(campaign.sms_body || campaign.email_body || "", vars);
          const r = await sendLine(creds.accessToken, c.line_user_id, lineBody);
          await supabase.from("line_message_log").insert({
            owner_id: user.id,
            location_id: custLocId,
            customer_id: c.id,
            line_user_id: c.line_user_id,
            job_type: "campaign",
            template_key: `campaign:${campaign_id}`,
            message: lineBody,
            status: r.ok ? "sent" : "failed",
            error: r.ok ? null : r.error,
          });
          if (!r.ok) send.sms_error = (send.sms_error ? send.sms_error + " | " : "") + r.error;
          await new Promise(r => setTimeout(r, 50));
        }
      }

      sends.push(send);
    }

    // 配信ログ一括INSERT
    if (sends.length > 0) {
      await supabase.from("campaign_sends").insert(sends);
    }

    await supabase.from("campaigns").update({
      status: "sent",
      sent_at: new Date().toISOString(),
    }).eq("id", campaign_id);

    return new Response(JSON.stringify({
      success: true,
      recipients: customers.length,
      email_sent: emailSuccess,
      sms_sent: smsSuccess,
      sms_failed: smsFailed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("send-campaign error:", e);
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", req.headers.get("x-campaign-id") || "");
    return new Response(JSON.stringify({ error: "Internal error", detail: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
