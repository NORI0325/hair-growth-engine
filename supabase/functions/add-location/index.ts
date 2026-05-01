// 追加店舗を作成 + Stripeサブスクリプションに追加店舗ライセンスを+1
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
    const { tenant_id, name, environment } = await req.json();
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    if (!tenant_id || !name || typeof name !== "string" || name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: corsHeaders });
    }

    const auth = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(auth?.replace("Bearer ", "") ?? "");
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    // 権限チェック: オーナーのみ
    const { data: member } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member || (member.role !== "owner" && member.role !== "super_admin")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    // 現在の店舗数を取得
    const { count: currentCount } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id);
    const newCount = (currentCount ?? 0) + 1;

    // サブスクリプションを取得
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, status")
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    // Stripeサブスクリプションが存在し、トライアル中でなければ追加店舗のlicenseを更新
    let stripeUpdated = false;
    if (sub?.stripe_subscription_id && sub.status !== "trialing") {
      const stripe = createStripeClient(env);
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

      // 追加店舗プライスを検索
      const prices = await stripe.prices.list({ lookup_keys: ["salon_boost_additional_location_monthly"] });
      if (!prices.data.length) {
        return new Response(JSON.stringify({ error: "additional_price_not_found" }), { status: 500, headers: corsHeaders });
      }
      const additionalPriceId = prices.data[0].id;

      // 既存のline_itemsから「追加店舗」アイテムを探す
      const existingAdditionalItem = stripeSub.items.data.find((item: any) => item.price.id === additionalPriceId);
      const additionalCount = newCount - 1; // 1店舗目はStandardプラン

      if (existingAdditionalItem) {
        // 既存アイテムの数量を更新
        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          items: [{ id: existingAdditionalItem.id, quantity: additionalCount }],
          proration_behavior: "create_prorations",
        });
      } else if (additionalCount > 0) {
        // 新規アイテムを追加
        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          items: [{ price: additionalPriceId, quantity: additionalCount }],
          proration_behavior: "create_prorations",
        });
      }
      stripeUpdated = true;
    }

    // 同名店舗の重複防止（先回りチェック）
    const { data: dup } = await supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", tenant_id)
      .ilike("name", name.trim())
      .maybeSingle();
    if (dup) {
      return new Response(JSON.stringify({ error: "duplicate_name", message: "同じ名前の店舗が既に存在します" }), { status: 409, headers: corsHeaders });
    }

    // location 作成
    const slug = `salon-${tenant_id.replace(/-/g, "").substring(0, 8)}-${Date.now().toString(36)}`;
    const { data: location, error } = await supabase
      .from("locations")
      .insert({
        tenant_id,
        name: name.trim(),
        public_slug: slug,
        is_primary: false,
      })
      .select()
      .single();
    if (error) throw error;

    // tenant の location_quota を更新
    await supabase.from("tenants").update({ location_quota: newCount }).eq("id", tenant_id);

    return new Response(JSON.stringify({ success: true, location, stripe_updated: stripeUpdated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("add-location error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
