// 追加店舗を作成 + Stripeサブスクリプションに追加店舗ライセンスを+1
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, setAdditionalLocationQuantity } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const serializeLocation = (location: any, userId: string) => ({
  id: location.id,
  name: location.name,
  tenant_id: location.tenant_id,
  public_slug: location.public_slug ?? null,
  is_primary: Boolean(location.is_primary),
  created_at: location.created_at ?? null,
  // 互換用: 現行 locations には active/company_id/owner_id/user_id 列がないため、
  // フロントの即時復元に必要な所属情報として安全な値を返す。
  active: true,
  company_id: null,
  owner_id: location.tenant_id,
  user_id: userId,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { tenant_id, name } = await req.json();
    const env: StripeEnv = Deno.env.get("STRIPE_ENV") === "live" ? "live" : "sandbox";

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
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!member || (member.role !== "owner" && member.role !== "super_admin")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    // 同名店舗の重複防止（先回りチェック）
    const { data: dup } = await supabase
      .from("locations")
      .select("id, tenant_id, name, is_primary, public_slug, created_at")
      .eq("tenant_id", tenant_id)
      .ilike("name", name.trim())
      .limit(1)
      .maybeSingle();
    if (dup) {
      const [{ data: tenantLink }, { data: locationLink }] = await Promise.all([
        supabase
          .from("tenant_members")
          .select("role, accepted_at")
          .eq("tenant_id", tenant_id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("location_members")
          .select("role")
          .eq("location_id", dup.id)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      console.warn("add-location duplicate visible-diagnostics", {
        tenantId: tenant_id,
        userId: user.id,
        duplicateLocationId: dup.id,
        hasTenantMembership: !!tenantLink,
        tenantRole: tenantLink?.role ?? null,
        tenantAccepted: !!tenantLink?.accepted_at,
        hasLocationMembership: !!locationLink,
        locationRole: locationLink?.role ?? null,
      });
      if (tenantLink?.accepted_at && !locationLink) {
        await supabase.from("location_members").upsert({
          location_id: dup.id,
          user_id: user.id,
          role: tenantLink.role,
        }, { onConflict: "location_id,user_id" });
      }
      return new Response(JSON.stringify({
        success: true,
        already_exists: true,
        restored_existing: true,
        location: serializeLocation(dup, user.id),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 重複確認後に現在数と契約を確定する。Stripeを先に進めない。
    const [{ count: currentCount }, { data: sub }] = await Promise.all([
      supabase.from("locations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id),
      supabase.from("subscriptions").select("stripe_subscription_id, status").eq("tenant_id", tenant_id).maybeSingle(),
    ]);
    const newCount = (currentCount ?? 0) + 1;

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

    const { error: membershipError } = await supabase.from("location_members").upsert({
      location_id: location.id,
      user_id: user.id,
      role: member.role,
    }, { onConflict: "location_id,user_id" });
    if (membershipError) {
      await supabase.from("locations").delete().eq("id", location.id);
      throw membershipError;
    }

    let stripeUpdated = false;
    try {
      if (sub?.stripe_subscription_id && sub.status !== "trialing") {
        stripeUpdated = await setAdditionalLocationQuantity(
          env,
          sub.stripe_subscription_id,
          Math.max(0, newCount - 1),
          `add-location-${tenant_id}-${location.id}`,
        );
      }
    } catch (stripeError) {
      const { error: cleanupError } = await supabase.from("locations").delete().eq("id", location.id);
      if (cleanupError) {
        console.error("add-location compensation failed", { locationId: location.id, cleanupError });
      }
      throw stripeError;
    }

    // tenant の location_quota を更新
    const { error: quotaError } = await supabase
      .from("tenants")
      .update({ location_quota: newCount })
      .eq("id", tenant_id);
    if (quotaError) {
      if (stripeUpdated && sub?.stripe_subscription_id) {
        try {
          await setAdditionalLocationQuantity(
            env,
            sub.stripe_subscription_id,
            Math.max(0, newCount - 2),
            `add-location-quota-rollback-${location.id}`,
          );
        } catch (rollbackError) {
          console.error("add-location Stripe quota compensation failed", {
            locationId: location.id,
            rollbackError,
          });
        }
      }
      const { error: cleanupError } = await supabase.from("locations").delete().eq("id", location.id);
      if (cleanupError) {
        console.error("add-location quota compensation failed", { locationId: location.id, cleanupError });
      }
      throw quotaError;
    }

    return new Response(JSON.stringify({
      success: true,
      restored_existing: false,
      location: serializeLocation(location, user.id),
      stripe_updated: stripeUpdated,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("add-location error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
