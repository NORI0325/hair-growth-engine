// One-shot helper: invokes salonboard-reservation-sync-scheduler with x-cron-secret header.
// Reads SALONBOARD_RESERVATION_SYNC_CRON_SECRET from env so the value is never exposed to the client.
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secret = Deno.env.get("SALONBOARD_RESERVATION_SYNC_CRON_SECRET") || "";
  if (!supabaseUrl || !secret) {
    return new Response(JSON.stringify({ ok: false, error: "missing_env", has_url: !!supabaseUrl, has_secret: !!secret }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/salonboard-reservation-sync-scheduler`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return new Response(JSON.stringify({ ok: res.ok, status: res.status, payload: safeJson(text) }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

function safeJson(t: string) { try { return JSON.parse(t); } catch { return t; } }
