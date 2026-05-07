import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const serializeLocation = (location: any, userId: string) => ({
  id: location.id,
  tenant_id: location.tenant_id,
  name: location.name,
  public_slug: location.public_slug ?? null,
  is_primary: Boolean(location.is_primary),
  created_at: location.created_at ?? "",
  active: true,
  company_id: null,
  owner_id: location.tenant_id,
  user_id: userId,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "missing_tenant_id" }), { status: 400, headers: corsHeaders });
    }

    const auth = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(auth?.replace("Bearer ", "") ?? "");
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const { data: member } = await supabase
      .from("tenant_members")
      .select("role, accepted_at")
      .eq("tenant_id", tenant_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member?.accepted_at) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    const { data: locations, error } = await supabase
      .from("locations")
      .select("id, tenant_id, name, public_slug, is_primary, created_at")
      .eq("tenant_id", tenant_id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) throw error;

    const memberships = (locations ?? []).map((location: any) => ({
      location_id: location.id,
      user_id: user.id,
      role: member.role,
    }));

    if (memberships.length > 0) {
      await supabase
        .from("location_members")
        .upsert(memberships, { onConflict: "location_id,user_id" });
    }

    console.info("recover-locations", {
      tenantId: tenant_id,
      userId: user.id,
      recoveredCount: locations?.length ?? 0,
      selectedPrimaryId: locations?.find((location: any) => location.is_primary)?.id ?? locations?.[0]?.id ?? null,
    });

    return new Response(JSON.stringify({
      success: true,
      locations: (locations ?? []).map((location: any) => serializeLocation(location, user.id)),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recover-locations error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});