// 店舗を削除 + Stripeサブスクリプションの追加店舗ライセンスを-1
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { location_id, environment } = await req.json();
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    if (!location_id) {
      return new Response(JSON.stringify({ error: "missing_location_id" }), { status: 400, headers: corsHeaders });
    }

    const auth = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(auth?.replace("Bearer ", "") ?? "");
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    // 対象店舗を取得
    const { data: location } = await supabase
      .from("locations")
      .select("id, tenant_id, is_primary")
      .eq("id", location_id)
      .maybeSingle();
    if (!location) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });

    if (location.is_primary) {
      return new Response(JSON.stringify({ error: "cannot_delete_primary" }), { status: 400, headers: corsHeaders });
    }

    // 権限
    const { data: member } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", location.tenant_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member || (member.role !== "owner" && member.role !== "super_admin")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    // 削除（CASCADEで関連データも削除されるが、既存データは owner_id ベースなので明示削除しない）
    const { error: delErr } = await supabase.from("locations").delete().eq("id", location_id);
    if (delErr) throw delErr;

    // 残りの店舗数
    const { count: remaining } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", location.tenant_id);
    const additionalCount = Math.max(0, (remaining ?? 1) - 1);

    // Stripeサブスクリプションを更新
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, status")
      .eq("tenant_id", location.tenant_id)
      .maybeSingle();

    if (sub?.stripe_subscription_id && sub.status !== "trialing") {
      const stripe = createStripeClient(env);
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const prices = await stripe.prices.list({ lookup_keys: ["salon_boost_additional_location_monthly"] });
      if (prices.data.length) {
        const additionalPriceId = prices.data[0].id;
        const item = stripeSub.items.data.find((it: any) => it.price.id === additionalPriceId);
        if (item) {
          if (additionalCount === 0) {
            await stripe.subscriptions.update(sub.stripe_subscription_id, {
              items: [{ id: item.id, deleted: true }],
              proration_behavior: "create_prorations",
            });
          } else {
            await stripe.subscriptions.update(sub.stripe_subscription_id, {
              items: [{ id: item.id, quantity: additionalCount }],
              proration_behavior: "create_prorations",
            });
          }
        }
      }
    }

    await supabase.from("tenants").update({ location_quota: remaining ?? 1 }).eq("id", location.tenant_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("remove-location error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
