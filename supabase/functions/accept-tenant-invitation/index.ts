import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ success: false, error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!user) return new Response(JSON.stringify({ success: false, error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const { token } = await req.json();
    if (!token) return new Response(JSON.stringify({ success: false, error: "missing_token" }), { status: 400, headers: corsHeaders });

    const { data: invite } = await supabase
      .from("tenant_invitations")
      .select("*")
      .eq("token", token)
      .is("accepted_at", null)
      .maybeSingle();

    if (!invite) return new Response(JSON.stringify({ success: false, error: "invalid_or_expired" }), { status: 404, headers: corsHeaders });
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ success: false, error: "expired" }), { status: 410, headers: corsHeaders });
    }
    if (invite.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
      return new Response(JSON.stringify({ success: false, error: "email_mismatch" }), { status: 403, headers: corsHeaders });
    }

    // tenant_members に追加
    const { error: memberErr } = await supabase.from("tenant_members").upsert({
      tenant_id: invite.tenant_id,
      user_id: user.id,
      role: invite.role,
      invited_at: invite.created_at,
      accepted_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,user_id" });

    if (memberErr) {
      return new Response(JSON.stringify({ success: false, error: memberErr.message }), { status: 500, headers: corsHeaders });
    }

    await supabase.from("tenant_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

    return new Response(JSON.stringify({ success: true, tenant_id: invite.tenant_id, role: invite.role }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
