// ワンタイムリンクの内容を取得（操作はしない）
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyActionToken, hashToken } from "../_shared/reservation-token.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response(JSON.stringify({ error: "missing_token" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await verifyActionToken(token);
  if (!payload) {
    return new Response(JSON.stringify({ error: "invalid_or_expired_token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const tokenHash = await hashToken(token);
  const { data: tokenRow } = await supabase
    .from("reservation_action_tokens")
    .select("id, used_at, expires_at, action")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: "token_not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "token_expired" }), {
      status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: rr } = await supabase
    .from("reservation_requests")
    .select("id, owner_id, customer_id, line_user_id, display_name, raw_message, desired_menu, desired_menu_items, desired_date_candidates, desired_staff_name, status, confirmed_date, confirmed_time, ai_parsed")
    .eq("id", payload.request_id)
    .maybeSingle();
  if (!rr) {
    return new Response(JSON.stringify({ error: "request_not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: owner } = await supabase
    .from("profiles")
    .select("salon_name")
    .eq("id", rr.owner_id)
    .maybeSingle();

  return new Response(JSON.stringify({
    success: true,
    action: payload.action,
    already_used: !!tokenRow.used_at,
    request: {
      id: rr.id,
      status: rr.status,
      display_name: rr.display_name,
      desired_menu: rr.desired_menu,
      desired_menu_items: rr.desired_menu_items,
      desired_date_candidates: rr.desired_date_candidates,
      desired_staff_name: rr.desired_staff_name,
      raw_message: rr.raw_message,
      confirmed_date: rr.confirmed_date,
      confirmed_time: rr.confirmed_time,
      ai_parsed: rr.ai_parsed,
    },
    salon_name: owner?.salon_name || "サロン",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
