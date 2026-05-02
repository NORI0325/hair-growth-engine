// 過去にskip/failedとなった external_reservation_logs を、
// Resend Inbound API から本文を取得し直して再処理するワンショット関数。
// 呼び出し: POST /functions/v1/reprocess-inbound-logs  (認証: ログインユーザー or service_role)
// body: { limit?: number, ownerId?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch { /* default empty */ }
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

  // skip/failed のログのうち、まだ booking が作られていないものを取得
  let q = supabase
    .from("external_reservation_logs")
    .select("id, raw_to, raw_from, raw_subject, raw_text, owner_id")
    .in("status", ["skipped", "failed"])
    .is("created_booking_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (body.ownerId) q = q.eq("owner_id", body.ownerId);

  const { data: logs, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  for (const log of logs ?? []) {
    // raw_text に email_id が埋め込まれている場合は抽出
    let emailId: string | null = null;
    const m = (log.raw_text || "").match(/"email_id"\s*:\s*"([^"]+)"/);
    if (m) emailId = m[1];

    if (!emailId) {
      results.push({ id: log.id, ok: false, reason: "no_email_id" });
      continue;
    }

    // inbound webhook を「正規の payload 形式」で再呼び出しする
    // → これだけで全ロジックが再実行される
    try {
      const inboundUrl = `${SUPABASE_URL}/functions/v1/inbound-reservation-email`;
      const fakePayload = {
        type: "email.received",
        data: {
          email_id: emailId,
          from: log.raw_from,
          to: [log.raw_to],
          subject: log.raw_subject,
        },
      };
      const res = await fetch(inboundUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "apikey": SERVICE_KEY,
        },
        body: JSON.stringify(fakePayload),
      });
      const j = await res.json().catch(() => ({}));
      results.push({ id: log.id, status: res.status, result: j });
    } catch (e: any) {
      results.push({ id: log.id, ok: false, error: e.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
