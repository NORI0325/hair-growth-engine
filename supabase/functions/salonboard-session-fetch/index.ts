// Worker専用: 店舗ごとの認証情報・保存済みセッションを返す
// Authorization: Bearer <EXTERNAL_WORKER_API_KEY>
// 優先順位:
//   A. salonboard_credentials から login_id/password を復号（正本）
//   B. salonboard_sessions から storage_state を復号できれば付与
//   C. salonboard_sessions の復号に失敗した場合は storage_state=null で続行
//   D. login_id/password の復号に失敗した場合のみエラー
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { decryptSalonboardText } from "../_shared/salonboardCrypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("authorization") || "";
    const expected = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    if (!expected || auth !== `Bearer ${expected}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { owner_id, location_id } = await req.json();
    if (!owner_id) {
      return new Response(JSON.stringify({ error: "missing_owner_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // A) salonboard_credentials を最優先（ID/PWの正本）
    let loginId: string | null = null, password: string | null = null, storageState: any = null;
    const { data: cred } = await supabase.from("salonboard_credentials")
      .select("login_id_encrypted,password_encrypted").eq("tenant_id", owner_id).maybeSingle();
    if (cred) {
      loginId = await decryptSalonboardText(cred.login_id_encrypted);
      password = await decryptSalonboardText(cred.password_encrypted);
    }

    // B/C) salonboard_sessions から storage_state を取得（復号失敗は無視）
    let sQ = supabase.from("salonboard_sessions")
      .select("login_id_encrypted,password_encrypted,storage_state_encrypted")
      .eq("owner_id", owner_id);
    sQ = location_id ? sQ.eq("location_id", location_id) : sQ.is("location_id", null);
    const { data: session } = await sQ.maybeSingle();
    if (session) {
      // ID/PW がまだ未取得ならフォールバックで salonboard_sessions からも試す
      if (!loginId) loginId = await decryptSalonboardText(session.login_id_encrypted);
      if (!password) password = await decryptSalonboardText(session.password_encrypted);
      const stateRaw = await decryptSalonboardText(session.storage_state_encrypted);
      if (stateRaw) {
        try { storageState = JSON.parse(stateRaw); } catch { storageState = null; }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      owner_id, location_id: location_id || null,
      login_id: loginId, password,
      storage_state: storageState,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("salonboard-session-fetch error", e);
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
