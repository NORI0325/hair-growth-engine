// Worker専用: 店舗ごとの認証情報・保存済みセッションを返す
// Authorization: Bearer <EXTERNAL_WORKER_API_KEY>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 簡易暗号化（AES-GCM, key=SALONBOARD_ENCRYPTION_KEY 32byte base64）
async function getKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("SALONBOARD_ENCRYPTION_KEY");
  if (!raw) return null;
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (bytes.length !== 32) return null;
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch { return null; }
}

export async function decryptText(payload: string | null): Promise<string | null> {
  if (!payload) return null;
  const key = await getKey();
  if (!key) return payload; // 鍵未設定 → 平文として扱う（暫定）
  try {
    const buf = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const iv = buf.slice(0, 12);
    const data = buf.slice(12);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(dec);
  } catch { return null; }
}

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

    let q = supabase.from("salonboard_sessions").select("*").eq("owner_id", owner_id);
    q = location_id ? q.eq("location_id", location_id) : q.is("location_id", null);
    const { data: session } = await q.maybeSingle();

    // Fallback: 旧 salonboard_credentials（tenant単位）
    let loginId: string | null = null, password: string | null = null, storageState: string | null = null;
    if (session) {
      loginId = await decryptText(session.login_id_encrypted);
      password = await decryptText(session.password_encrypted);
      storageState = await decryptText(session.storage_state_encrypted);
    } else {
      const { data: legacy } = await supabase.from("salonboard_credentials")
        .select("*").eq("tenant_id", owner_id).maybeSingle();
      if (legacy) {
        loginId = await decryptText(legacy.login_id_encrypted);
        password = await decryptText(legacy.password_encrypted);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      owner_id, location_id: location_id || null,
      login_id: loginId, password,
      storage_state: storageState ? JSON.parse(storageState) : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("salonboard-session-fetch error", e);
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
