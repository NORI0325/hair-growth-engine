import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import React from "https://esm.sh/react@18.3.1";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";
import { sendTransactionalEmailInternal } from "../_shared/invoke-internal.ts";

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

    const { email, role, tenant_id, location_ids } = await req.json();
    if (!email || !role || !tenant_id) {
      return new Response(JSON.stringify({ success: false, error: "missing_params" }), { status: 400, headers: corsHeaders });
    }
    const locIds: string[] | null = Array.isArray(location_ids) && location_ids.length > 0 ? location_ids : null;

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
      tenant_id, email: email.toLowerCase(), role, token, invited_by: user.id, location_ids: locIds,
    }).select().single();

    if (insertErr) {
      return new Response(JSON.stringify({ success: false, error: insertErr.message }), { status: 500, headers: corsHeaders });
    }

    // 招待メール送信（正式テンプレート使用）
    const { data: tenantProfile } = await supabase.from("profiles").select("salon_name").eq("id", tenant_id).maybeSingle();
    const { data: inviterProfile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const appUrl = Deno.env.get("APP_URL") ?? "https://hair-growth-engine.lovable.app";
    const redirectTo = `${appUrl}/invite/${token}`;

    // ===== マジックリンク方式：パスワード不要で1クリックでログイン → 自動受諾 =====
    // 既存ユーザーかどうかで type を切替（invite=未登録ユーザー作成、magiclink=既存ユーザー）
    let actionLink: string | null = null;

    // まず invite で発行を試みる（ユーザーが存在しない場合に成功）
    const inviteGen = await supabase.auth.admin.generateLink({
      type: "invite",
      email: email.toLowerCase(),
      options: { redirectTo },
    });

    if (inviteGen.data?.properties?.action_link) {
      actionLink = inviteGen.data.properties.action_link;
    } else {
      // ユーザーが既に存在 → マジックリンクで発行
      const magicGen = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: email.toLowerCase(),
        options: { redirectTo },
      });
      if (magicGen.data?.properties?.action_link) {
        actionLink = magicGen.data.properties.action_link;
      } else {
        console.error("generateLink failed:", inviteGen.error, magicGen.error);
      }
    }

    // フォールバック：マジックリンク発行失敗時は従来の招待ページURLを使う
    const inviteUrl = actionLink ?? redirectTo;

    const { error: emailErr } = await supabase.functions.invoke("send-transactional-email", {
      headers: { Authorization: auth },
      body: {
        templateName: "team-invitation",
        recipientEmail: email,
        idempotencyKey: `team-invite-${invite.id}`,
        templateData: {
          salonName: tenantProfile?.salon_name ?? "サロン",
          inviterName: inviterProfile?.full_name ?? null,
          role,
          inviteUrl,
        },
      },
    });
    if (emailErr) {
      console.error("send-team-invitation email error:", emailErr);
      await supabase.from("tenant_invitations").delete().eq("id", invite.id);
      return new Response(JSON.stringify({ success: false, error: "email_send_failed", detail: String(emailErr?.message ?? emailErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, invite_id: invite.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
