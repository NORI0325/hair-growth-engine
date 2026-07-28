import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getLineCredentials } from "../_shared/line-push.ts";
import { sendTransactionalEmailInternal } from "../_shared/invoke-internal.ts";
import { sendSmsWithLog } from "../_shared/twilio-sms.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

const MAX_SYNCHRONOUS_RECIPIENTS = 500;
const getAppOrigin = (): string =>
  (Deno.env.get("PUBLIC_APP_ORIGIN") || Deno.env.get("APP_URL") || "https://saronboost.com").replace(/\/$/, "");

function tokyoDateOffset(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

const renderTemplate = (template: string, vars: Record<string, string>) => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || "");
};

const isValidLineUserId = (s: string | null | undefined) => !!s && /^U[0-9a-f]{32}$/i.test(s);

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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const identity = await authenticateRequest(req, supabase);
  if (identity.kind !== "user") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  let requestedCampaignId = "";
  try {
    const { campaign_id } = await req.json();
    requestedCampaignId = typeof campaign_id === "string" ? campaign_id : "";
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id required" }), { status: 400, headers: corsHeaders });
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaign_id)
      .maybeSingle();

    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404, headers: corsHeaders });
    }
    if (campaign.status !== "draft") {
      return new Response(JSON.stringify({
        error: "CAMPAIGN_ALREADY_STARTED",
        message: "このキャンペーンは既に配信処理を開始しています。",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const ownerId = String(campaign.owner_id || "");
    const locationId = String(campaign.location_id || "");
    if (!ownerId || !locationId || !(await canAccessOwner(supabase, identity.userId, ownerId, ["owner", "manager", "super_admin"]))) {
      return new Response(JSON.stringify({ error: "Campaign access denied" }), { status: 403, headers: corsHeaders });
    }
    const { data: location } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("tenant_id", ownerId)
      .maybeSingle();
    if (!location) {
      return new Response(JSON.stringify({ error: "Campaign location invalid" }), { status: 400, headers: corsHeaders });
    }

    // セグメントに該当する顧客を取得
    let q = supabase.from("customers")
      .select("id, full_name, email, phone, last_visit_date, line_user_id, location_id, is_test, opt_out_automation, line_unfollowed_at")
      .eq("owner_id", ownerId)
      .eq("location_id", locationId)
      .eq("is_test", false)
      .or("opt_out_automation.is.null,opt_out_automation.eq.false");
    if ((campaign as any).location_id) q = q.eq("location_id", (campaign as any).location_id);

    if (campaign.target_segment === "dormant") {
      q = q.or(`last_visit_date.is.null,last_visit_date.lt.${tokyoDateOffset(-180)}`);
    } else if (campaign.target_segment === "at_risk") {
      q = q.gte("last_visit_date", tokyoDateOffset(-180)).lt("last_visit_date", tokyoDateOffset(-90));
    } else if (campaign.target_segment === "active") {
      q = q.gte("last_visit_date", tokyoDateOffset(-90));
    }

    const { data: customers, error: customersError } = await q.limit(MAX_SYNCHRONOUS_RECIPIENTS + 1);
    if (customersError) throw customersError;
    if ((customers?.length || 0) > MAX_SYNCHRONOUS_RECIPIENTS) {
      return new Response(JSON.stringify({
        error: "CAMPAIGN_RECIPIENT_LIMIT_EXCEEDED",
        message: "対象が500名を超えています。重複送信防止のため、永続配信キュー対応後に実行してください。",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!customers || customers.length === 0) {
      await supabase.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString(), total_recipients: 0 }).eq("owner_id", ownerId).eq("id", campaign_id);
      return new Response(JSON.stringify({ success: true, recipients: 0 }), { headers: corsHeaders });
    }

    // 条件付き更新をロック代わりにし、二重実行を拒否する。
    const { data: startedCampaign, error: startError } = await supabase
      .from("campaigns")
      .update({ status: "sending", total_recipients: customers.length })
      .eq("owner_id", ownerId)
      .eq("id", campaign_id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (startError) throw startError;
    if (!startedCampaign) {
      return new Response(JSON.stringify({ error: "CAMPAIGN_ALREADY_STARTED" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ownerProfile（salon_name用）
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("salon_name")
      .eq("id", ownerId)
      .maybeSingle();

    // 各顧客にbooking_tokenを取得して配信
    const { data: tokens } = await supabase
      .from("booking_tokens")
      .select("customer_id, token")
      .in("customer_id", customers.map(c => c.id));

    const tokenMap = new Map(tokens?.map(t => [t.customer_id, t.token]) || []);
    const origin = getAppOrigin();

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
      let attemptedDelivery = false;

      // メール（送信キュー経由で実配信）
      if (campaign.send_email && c.email) {
        attemptedDelivery = true;
        const r = await sendTransactionalEmailInternal({
          templateName: "thank-you",
          recipientEmail: c.email,
          idempotencyKey: `campaign-${campaign_id}-${c.id}`,
          templateData: {
            customerName: c.full_name,
            salonName: ownerProfile?.salon_name || "サロン",
            bookingLink,
          },
        });
        if (r.ok) { send.email_sent = true; emailSuccess++; }
        else { console.error("[send-campaign] email fail", { campaign_id, customer_id: c.id, ...r }); }
      }

      // SMS
      if (campaign.send_sms && c.phone && campaign.sms_body) {
        attemptedDelivery = true;
        const smsBody = renderTemplate(campaign.sms_body, vars);
        const smsLocId = (c as any).location_id || (campaign as any).location_id || null;
        const result = await sendSmsWithLog(supabase, {
          owner_id: ownerId,
          location_id: smsLocId,
          customer_id: c.id,
          phone: c.phone,
          message: smsBody,
          source: "send_campaign",
          campaign_id,
          metadata: {
            campaign_title: campaign.title,
            booking_link: bookingLink,
          },
        });
        if (result.ok) {
          send.sms_sent = true;
          smsSuccess++;
        } else {
          send.sms_error = result.err || result.reason || "unknown";
          smsFailed++;
        }
        await new Promise(r => setTimeout(r, 100));
      }

      // LINE Push（顧客にLINE ID登録があり、店舗別または共通トークンがあれば）
      const lineUserId = typeof c.line_user_id === "string" ? c.line_user_id.trim() : "";
      if (isValidLineUserId(lineUserId) && !c.line_unfollowed_at) {
        const custLocId = (c as any).location_id || (campaign as any).location_id || null;
        const creds = await getLineCredentials(supabase, ownerId, custLocId);
        if (creds) {
          const lineBody = renderTemplate(campaign.sms_body || campaign.email_body || "", vars);
          attemptedDelivery = true;
          const r = await sendLine(creds.accessToken, lineUserId, lineBody);
          await supabase.from("line_message_log").insert({
            owner_id: ownerId,
            location_id: custLocId,
            customer_id: c.id,
            line_user_id: lineUserId,
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

      if (attemptedDelivery) sends.push(send);
    }

    // 配信ログ一括INSERT
    if (sends.length > 0) {
      await supabase.from("campaign_sends").insert(sends);
    }

    await supabase.from("campaigns").update({
      status: "sent",
      sent_at: new Date().toISOString(),
    }).eq("owner_id", ownerId).eq("id", campaign_id);

    return new Response(JSON.stringify({
      success: true,
      recipients: customers.length,
      email_sent: emailSuccess,
      sms_sent: smsSuccess,
      sms_failed: smsFailed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("send-campaign error:", e);
    if (requestedCampaignId) {
      await supabase.from("campaigns").update({ status: "failed" }).eq("id", requestedCampaignId).eq("status", "sending");
    }
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
