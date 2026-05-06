// オーナー/マネージャーがサロンボードのID/PWを保存する。
// ID/PW は salonboard_credentials（正本）に保存する。
// salonboard_sessions は storage_state 用なので、ID/PW再保存時は古いセッションを無効化する。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

async function getKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("SALONBOARD_ENCRYPTION_KEY");
  if (!raw) return null;
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (bytes.length !== 32) return null;
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch { return null; }
}
async function encryptText(plain: string): Promise<string> {
  const key = await getKey();
  if (!key) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const merged = new Uint8Array(iv.length + enc.byteLength);
  merged.set(iv, 0); merged.set(new Uint8Array(enc), iv.length);
  return btoa(String.fromCharCode(...merged));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } });
    const { data: u } = await sbAuth.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const { owner_id, location_id, login_id, password } = await req.json();
    if (!owner_id || !login_id || !password) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // tenant manager check
    const { data: tm } = await sb.from("tenant_members").select("role")
      .eq("tenant_id", owner_id).eq("user_id", u.user.id).not("accepted_at", "is", null).maybeSingle();
    if (!tm || !["owner", "manager", "super_admin"].includes(tm.role)) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    const loginEnc = await encryptText(String(login_id));
    const pwEnc = await encryptText(String(password));

    // 1) salonboard_credentials（ID/PW正本: tenant単位）にupsert
    const { data: credExisting } = await sb.from("salonboard_credentials")
      .select("id").eq("tenant_id", owner_id).maybeSingle();
    const credPatch = {
      tenant_id: owner_id,
      login_id_encrypted: loginEnc,
      password_encrypted: pwEnc,
      login_status: "unknown",
      last_error: null,
    };
    if (credExisting) {
      await sb.from("salonboard_credentials").update(credPatch).eq("id", credExisting.id);
    } else {
      await sb.from("salonboard_credentials").insert(credPatch);
    }

    // 2) 古い salonboard_sessions（storage_state 含む）は無効化のため削除
    //    新キーで再ログインさせて新しい storage_state を保存させる。
    let delQ = sb.from("salonboard_sessions").delete().eq("owner_id", owner_id);
    delQ = location_id ? delQ.eq("location_id", location_id) : delQ.is("location_id", null);
    await delQ;

    // 3) channel_integrations を connected に更新（無ければ作成）
    let ciQ = sb.from("channel_integrations").select("id").eq("owner_id", owner_id).eq("channel", "salonboard");
    ciQ = location_id ? ciQ.eq("location_id", location_id) : ciQ.is("location_id", null);
    const { data: ciExisting } = await ciQ.maybeSingle();
    if (ciExisting) {
      await sb.from("channel_integrations").update({ enabled: true, connection_status: "connected", last_error: null })
        .eq("id", ciExisting.id);
    } else {
      await sb.from("channel_integrations").insert({
        owner_id, location_id: location_id || null, channel: "salonboard",
        enabled: true, sync_enabled: false, connection_status: "connected",
      });
    }
    await sb.rpc("recompute_channel_status", { _owner_id: owner_id, _location_id: location_id || null });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
