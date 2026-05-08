// Worker専用: ログイン後の storageState と最新ステータスを保存
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { encryptSalonboardText } from "../_shared/salonboardCrypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("authorization") || "";
    const expected = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const reason = !expected ? "EXTERNAL_WORKER_API_KEY missing in edge secrets"
      : !auth ? "missing Authorization header"
      : !auth.startsWith("Bearer ") ? "Authorization header is not Bearer"
      : provided !== expected ? "Bearer token mismatch (worker WORKER_API_KEY != edge EXTERNAL_WORKER_API_KEY)"
      : null;
    if (reason) {
      console.error("[salonboard-session-save] 401", {
        reason,
        expected_present: !!expected,
        expected_len: expected?.length ?? 0,
        provided_len: provided.length,
        expected_prefix: expected ? expected.slice(0, 4) : null,
        provided_prefix: provided ? provided.slice(0, 4) : null,
      });
      return new Response(JSON.stringify({ error: "unauthorized", reason }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { owner_id, location_id, storage_state, login_status, last_error } = await req.json();
    if (!owner_id) {
      return new Response(JSON.stringify({ error: "missing_owner_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const enc = storage_state ? await encryptSalonboardText(JSON.stringify(storage_state)) : null;

    // upsert by (owner_id, location_id)
    let q = supabase.from("salonboard_sessions").select("id").eq("owner_id", owner_id);
    q = location_id ? q.eq("location_id", location_id) : q.is("location_id", null);
    const { data: existing } = await q.maybeSingle();

    const patch: any = {
      owner_id, location_id: location_id || null,
      login_status: login_status || "ok",
      last_login_at: new Date().toISOString(),
      last_error: last_error || null,
    };
    if (enc) patch.storage_state_encrypted = enc;

    if (existing) {
      await supabase.from("salonboard_sessions").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("salonboard_sessions").insert(patch);
    }

    // channel_integrations 側も更新
    let ciQ = supabase.from("channel_integrations").update({
      last_login_at: patch.last_login_at,
      ...(login_status === "ok" || !login_status ? { last_success_at: new Date().toISOString() } : {}),
    }).eq("owner_id", owner_id).eq("channel", "salonboard");
    ciQ = location_id ? ciQ.eq("location_id", location_id) : ciQ.is("location_id", null);
    await ciQ;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("salonboard-session-save error", e);
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
