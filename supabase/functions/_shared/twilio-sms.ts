// Twilio SMS送信ユーティリティ（コネクター経由）
// Twilio未接続時はskippedを返す（エラーにしない）
const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

export interface SmsResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  err?: string;
  sid?: string;
}

// E.164形式に正規化（日本前提）
export function toE164JP(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw)
    .replace(/[\u3000\s\-－ー―‐\(\)（）]/g, "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (s.startsWith("+")) return /^\+\d{8,15}$/.test(s) ? s : null;
  if (s.startsWith("81")) s = "0" + s.slice(2);
  if (!/^\d{10,11}$/.test(s)) return null;
  // 先頭0を除き+81を付ける
  return "+81" + s.slice(1);
}

export async function sendSms(toRaw: string, body: string, fromOverride?: string): Promise<SmsResult> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twilioKey = Deno.env.get("TWILIO_API_KEY");
  const fromNumber = fromOverride || Deno.env.get("TWILIO_FROM_NUMBER") || Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!lovableKey || !twilioKey) {
    return { ok: false, skipped: true, reason: "twilio_not_connected" };
  }
  if (!fromNumber) {
    return { ok: false, skipped: true, reason: "twilio_from_number_missing" };
  }

  const to = toE164JP(toRaw);
  if (!to) return { ok: false, skipped: true, reason: "invalid_phone" };

  try {
    const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: fromNumber,
        Body: body.slice(0, 1500),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, err: `Twilio ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
    }
    return { ok: true, sid: (data as any)?.sid };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "unknown" };
  }
}

export type SmsLogSource = "send_campaign" | "bulk_broadcast" | "scheduled_job" | "sms_test";

export interface SmsLogParams {
  owner_id: string;
  location_id?: string | null;
  customer_id?: string | null;
  phone: string;
  message: string;
  source: SmsLogSource;
  job_type?: string | null;
  campaign_id?: string | null;
  scheduled_job_id?: string | null;
  metadata?: Record<string, unknown>;
  from_override?: string;
}

export async function sendSmsWithLog(supabase: any, params: SmsLogParams): Promise<SmsResult> {
  const normalizedPhone = toE164JP(params.phone);
  const result = await sendSms(params.phone, params.message, params.from_override);
  const status = result.ok ? "sent" : result.skipped ? "skipped" : "failed";
  const error = result.ok ? null : result.err || result.reason || "unknown";
  const sentAt = result.ok ? new Date().toISOString() : null;

  const { error: logError } = await supabase.from("sms_message_log").insert({
    owner_id: params.owner_id,
    location_id: params.location_id ?? null,
    customer_id: params.customer_id ?? null,
    phone: params.phone,
    normalized_phone: normalizedPhone,
    message: params.message,
    source: params.source,
    job_type: params.job_type ?? null,
    campaign_id: params.campaign_id ?? null,
    scheduled_job_id: params.scheduled_job_id ?? null,
    status,
    error,
    provider: "twilio",
    provider_sid: result.sid ?? null,
    metadata: params.metadata ?? {},
    sent_at: sentAt,
  });

  if (logError) {
    console.warn("[sms] failed to insert sms_message_log", {
      source: params.source,
      owner_id: params.owner_id,
      customer_id: params.customer_id,
      error: logError.message,
    });
  }

  return result;
}
