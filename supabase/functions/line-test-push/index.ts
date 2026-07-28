// 設定画面からのLINEテスト送信。認証必須（オーナー本人のみ）
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getLineCredentials, sendLinePush } from "../_shared/line-push.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const identity = await authenticateRequest(req, supabase);
    if (identity.kind !== "user") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const ownerId = String(body?.owner_id || "");
    const locationId = body?.location_id ? String(body.location_id) : "";
    const lineUserId = String(body?.lineUserId || "").trim();
    if (!ownerId || !locationId || !await canAccessOwner(supabase, identity.userId, ownerId, ["owner", "manager", "super_admin"])) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: location } = await supabase.from("locations").select("id")
      .eq("id", locationId).eq("tenant_id", ownerId).maybeSingle();
    if (!location) return new Response(JSON.stringify({ error: "invalid_location" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    if (!lineUserId || !/^U[0-9a-f]{32}$/i.test(lineUserId)) {
      return new Response(JSON.stringify({ error: "invalid_user_id", message: "LINE UserIDは「U」で始まる33文字の英数字です。" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("salon_name")
      .eq("id", ownerId)
      .maybeSingle();

    const creds = await getLineCredentials(supabase, ownerId, locationId);
    if (!creds) {
      return new Response(JSON.stringify({ error: "no_token", message: "チャネルアクセストークンが未設定です。" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = `🧪 LINE接続テスト\n\n${profile?.salon_name || "サロン"}のシステムから送信されました。\n\nこのメッセージが届いていれば、LINE配信の設定は正常に動作しています ✅`;
    const r = await sendLinePush(creds.accessToken, lineUserId, text);

    if (!r.ok) {
      let message = r.err || "送信に失敗しました";
      if (r.status === 401) message = "❌ チャネルアクセストークンが無効です。LINE Developers Consoleで再発行してください。";
      else if (r.status === 400) message = "❌ LINE UserIDが正しくないか、そのユーザーが公式アカウントを友だち追加していません。";
      else if (r.status === 403) message = "❌ Messaging APIの利用が許可されていません。LINE公式アカウントの設定を確認してください。";
      return new Response(JSON.stringify({ error: "send_failed", message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("line-test-push error:", e);
    return new Response(JSON.stringify({ error: "internal", message: "LINEテスト送信に失敗しました。" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
