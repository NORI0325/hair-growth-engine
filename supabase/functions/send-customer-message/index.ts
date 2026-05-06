import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ownerId = userData.user.id;

    const body = await req.json();
    const customerId = String(body.customer_id || "");
    const message = String(body.message || "").slice(0, 2000);
    if (!customerId || message.length < 2) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: customer } = await supabase
      .from("customers")
      .select("id, full_name, line_user_id, owner_id, location_id")
      .eq("id", customerId)
      .maybeSingle();

    if (!customer || customer.owner_id !== ownerId) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!customer.line_user_id) {
      return new Response(JSON.stringify({
        error: "no_line",
        message: "このお客様はLINE未連携です。お電話やSMSでご連絡ください。",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const locationId = (customer as any).location_id || null;
    const creds = await getLineCredentials(supabase, ownerId, locationId);
    if (!creds) {
      return new Response(JSON.stringify({ error: "line_not_configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("salon_name")
      .eq("id", ownerId)
      .maybeSingle();

    const finalMessage = `${message}\n\n— ${prof?.salon_name || "サロン"}`;
    const r = await sendLinePush(creds.accessToken, customer.line_user_id, finalMessage);

    // ログに記録
    await supabase.from("line_message_log").insert({
      owner_id: ownerId,
      location_id: locationId,
      customer_id: customer.id,
      line_user_id: customer.line_user_id,
      job_type: "customer_message",
      message: finalMessage,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : r.err,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-customer-message error:", e);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
