import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import React from "https://esm.sh/react@18.3.1";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";

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

    const { email, role, tenant_id } = await req.json();
    if (!email || !role || !tenant_id) {
      return new Response(JSON.stringify({ success: false, error: "missing_params" }), { status: 400, headers: corsHeaders });
    }

    // 権限チェック：オーナーのみ
    const { data: ownerCheck } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!ownerCheck || (ownerCheck.role !== "owner" && ownerCheck.role !== "super_admin")) {
      return new Response(JSON.stringify({ success: false, error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    // トークン生成
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

    const { data: invite, error: insertErr } = await supabase.from("tenant_invitations").insert({
      tenant_id, email: email.toLowerCase(), role, token, invited_by: user.id,
    }).select().single();

    if (insertErr) {
      return new Response(JSON.stringify({ success: false, error: insertErr.message }), { status: 500, headers: corsHeaders });
    }

    // 招待メール送信
    const { data: tenantProfile } = await supabase.from("profiles").select("salon_name").eq("id", tenant_id).maybeSingle();
    const inviteUrl = `${Deno.env.get("APP_URL") ?? "https://hair-growth-engine.lovable.app"}/invite/${token}`;

    await supabase.functions.invoke("send-transactional-email", {
      body: {
        to: email,
        subject: `${tenantProfile?.salon_name ?? "サロン"} からの招待`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
            <h1>${tenantProfile?.salon_name ?? "サロン"} へのご招待</h1>
            <p>${tenantProfile?.salon_name ?? "サロン"}のオーナーからスタッフ用アカウントの招待が届きました。</p>
            <p><strong>役割:</strong> ${role === "manager" ? "マネージャー" : "スタッフ"}</p>
            <p>下のボタンをクリックして参加してください。招待は7日間有効です。</p>
            <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:4px">招待を受諾する</a></p>
            <p style="color:#666;font-size:12px;margin-top:24px">${inviteUrl}</p>
          </div>
        `,
      },
    });

    return new Response(JSON.stringify({ success: true, invite_id: invite.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
