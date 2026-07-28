// 店舗を削除 + Stripeサブスクリプションの追加店舗ライセンスを-1
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, setAdditionalLocationQuantity } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { location_id } = await req.json();
    const env: StripeEnv = Deno.env.get("STRIPE_ENV") === "live" ? "live" : "sandbox";

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
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!member || (member.role !== "owner" && member.role !== "super_admin")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    const { count: currentCount } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", location.tenant_id);
    const remaining = Math.max(1, (currentCount ?? 1) - 1);
    const additionalCount = Math.max(0, remaining - 1);
    const previousAdditionalCount = Math.max(0, (currentCount ?? 1) - 1);

    // Stripeサブスクリプションを更新
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, status")
      .eq("tenant_id", location.tenant_id)
      .maybeSingle();

    let stripeUpdated = false;
    if (sub?.stripe_subscription_id && sub.status !== "trialing") {
      stripeUpdated = await setAdditionalLocationQuantity(
        env,
        sub.stripe_subscription_id,
        additionalCount,
        `remove-location-${location_id}`,
      );
    }

    // Stripe更新後にDBを削除。DB削除失敗時は請求数量を元に戻す。
    const { error: delErr } = await supabase.from("locations").delete().eq("id", location_id);
    if (delErr) {
      if (stripeUpdated && sub?.stripe_subscription_id) {
        try {
          await setAdditionalLocationQuantity(
            env,
            sub.stripe_subscription_id,
            previousAdditionalCount,
            `remove-location-rollback-${location_id}`,
          );
        } catch (rollbackError) {
          console.error("remove-location Stripe compensation failed", { locationId: location_id, rollbackError });
        }
      }
      throw delErr;
    }

    const { error: quotaError } = await supabase
      .from("tenants")
      .update({ location_quota: remaining })
      .eq("id", location.tenant_id);
    if (quotaError) {
      console.error("remove-location quota update failed", {
        tenantId: location.tenant_id,
        remaining,
        quotaError,
      });
    }

    return new Response(JSON.stringify({ success: true, quota_updated: !quotaError }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("remove-location error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
