import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(auth?.replace("Bearer ", "") ?? "");
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const body = await req.json().catch(() => ({}));
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : null;
    const env: StripeEnv = Deno.env.get("STRIPE_ENV") === "live" ? "live" : "sandbox";
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "missing_tenant_id" }), { status: 400, headers: corsHeaders });
    }

    const { data: member } = await supabase.from("tenant_members")
      .select("role, accepted_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!member || (member.role !== "owner" && member.role !== "super_admin")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    const { data: sub } = await supabase.from("subscriptions")
      .select("stripe_customer_id, owner_id")
      .eq("owner_id", tenantId).maybeSingle();
    if (!sub?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: "no_customer" }), { status: 404, headers: corsHeaders });
    }

    const stripe = createStripeClient(env);
    const baseUrl = (Deno.env.get("PUBLIC_APP_ORIGIN") ?? Deno.env.get("APP_URL") ?? "https://saronboost.com").replace(/\/$/, "");
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${baseUrl}/billing`,
    });

    return new Response(JSON.stringify({ url: portal.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
