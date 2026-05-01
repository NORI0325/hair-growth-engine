import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { tenant_id, environment, returnUrl } = await req.json();
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    const auth = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(auth?.replace("Bearer ", "") ?? "");
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    if (!tenant_id) return new Response(JSON.stringify({ error: "missing_tenant_id" }), { status: 400, headers: corsHeaders });

    // 権限：オーナーまたはsuper_admin
    const { data: member } = await supabase.from("tenant_members")
      .select("role").eq("tenant_id", tenant_id).eq("user_id", user.id).maybeSingle();
    if (!member || (member.role !== "owner" && member.role !== "super_admin")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    const stripe = createStripeClient(env);
    const prices = await stripe.prices.list({ lookup_keys: ["standard_monthly_jpy"] });
    if (!prices.data.length) return new Response(JSON.stringify({ error: "price_not_found" }), { status: 500, headers: corsHeaders });

    const baseUrl = Deno.env.get("APP_URL") ?? "https://hair-growth-engine.lovable.app";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: prices.data[0].id, quantity: 1 }],
      customer_email: user.email,
      success_url: returnUrl ?? `${baseUrl}/billing?checkout=success`,
      cancel_url: `${baseUrl}/billing?checkout=cancelled`,
      metadata: { tenant_id, user_id: user.id },
      subscription_data: { metadata: { tenant_id, user_id: user.id } },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
