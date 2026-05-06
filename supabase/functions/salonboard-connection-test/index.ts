// 疎通テスト：認証情報復号 → Worker dry-run create/update/cancel を順に実行
// 全パスで channel_integrations.connection_status='live' に自動昇格
// 失敗時は connection_status='needs_review' (or 'error') にして last_error を記録
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { decryptSalonboardText, getSalonboardKeyDiagnostic } from "../_shared/salonboardCrypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userRes } = await supabaseAuth.auth.getUser();
    if (!userRes?.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    const { owner_id, location_id } = await req.json();
    if (!owner_id) return json({ error: "missing_owner_id" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // tenant manager+ チェック
    const { data: hasRole } = await supabase.rpc("has_tenant_role", {
      _tenant_id: owner_id, _user_id: userId, _min_role: "manager",
    });
    if (!hasRole) return json({ error: "forbidden" }, 403);

    const workerUrl = Deno.env.get("EXTERNAL_WORKER_API_URL");
    const workerKey = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    if (!workerUrl || !workerKey) {
      return json({ ok: false, error: "worker_env_missing" }, 500);
    }

    const steps: Array<{ kind: string; ok: boolean; status?: number; latency_ms?: number; error?: string; body?: unknown }> = [];

    const updateIntegration = async (patch: Record<string, unknown>) => {
      let q = supabase.from("channel_integrations").update(patch)
        .eq("owner_id", owner_id).eq("channel", "salonboard");
      q = location_id ? q.eq("location_id", location_id) : q.is("location_id", null);
      await q;
    };

    const logRow = async (kind: string, payload: unknown, status: number | null, body: unknown, latency: number, success: boolean, error?: string) => {
      await supabase.from("worker_request_logs").insert({
        owner_id, location_id: location_id || null, channel: "salonboard",
        kind, request_payload: payload, response_status: status,
        response_body: typeof body === "object" ? body : { raw: String(body) },
        latency_ms: latency, success, error_message: error || null,
      });
    };

    // Step 1: 認証情報復号確認
    // 優先順位: salonboard_credentials（ID/PW正本） → salonboard_sessions（フォールバック）
    const keyPresent = !!Deno.env.get("SALONBOARD_ENCRYPTION_KEY");
    let loginId: string | null = null, password: string | null = null;
    let credentialsFound = false;
    let encryptedFieldsPresent = false;
    let source: "salonboard_sessions" | "salonboard_credentials" | "none" = "none";

    const { data: cred } = await supabase.from("salonboard_credentials")
      .select("login_id_encrypted,password_encrypted").eq("tenant_id", owner_id).maybeSingle();
    if (cred) {
      credentialsFound = true;
      source = "salonboard_credentials";
      encryptedFieldsPresent = !!(cred.login_id_encrypted && cred.password_encrypted);
      loginId = await decryptText(cred.login_id_encrypted);
      password = await decryptText(cred.password_encrypted);
    } else {
      let q = supabase.from("salonboard_sessions").select("login_id_encrypted,password_encrypted").eq("owner_id", owner_id);
      q = location_id ? q.eq("location_id", location_id) : q.is("location_id", null);
      const { data: session } = await q.maybeSingle();
      if (session) {
        credentialsFound = true;
        source = "salonboard_sessions";
        encryptedFieldsPresent = !!(session.login_id_encrypted && session.password_encrypted);
        loginId = await decryptText(session.login_id_encrypted);
        password = await decryptText(session.password_encrypted);
      }
    }

    // 古い salonboard_sessions が新キーで復号できない場合は削除しておく（fresh login で再保存される）
    if (source === "salonboard_credentials" && keyPresent) {
      let sQ = supabase.from("salonboard_sessions").select("id,storage_state_encrypted").eq("owner_id", owner_id);
      sQ = location_id ? sQ.eq("location_id", location_id) : sQ.is("location_id", null);
      const { data: stale } = await sQ.maybeSingle();
      if (stale?.storage_state_encrypted) {
        const ok = await decryptText(stale.storage_state_encrypted);
        if (!ok) {
          await supabase.from("salonboard_sessions").delete().eq("id", stale.id);
        }
      }
    }
    const credsOk = !!(loginId && password);
    let errorCode: string | undefined;
    if (!credsOk) {
      if (!credentialsFound) errorCode = "credentials_not_saved";
      else if (!keyPresent) errorCode = "encryption_key_missing";
      else if (!encryptedFieldsPresent) errorCode = "encrypted_fields_empty";
      else errorCode = "decrypt_failed_key_mismatch";
    }

    steps.push({
      kind: "decrypt_credentials",
      ok: credsOk,
      error: errorCode,
      diagnostic: { credentials_found: credentialsFound, owner_id, location_id: location_id || null,
        encrypted_fields_present: encryptedFieldsPresent, key_present: keyPresent, source },
    });

    if (!credsOk) {
      await updateIntegration({
        connection_status: errorCode === "credentials_not_saved" ? "disconnected" : "error",
        last_error: `${errorCode}: ${
          errorCode === "credentials_not_saved" ? "ID/PWが未保存です。チャンネル連携画面の「ログイン情報設定」から保存してください。" :
          errorCode === "encryption_key_missing" ? "サーバー側の暗号化キーが未設定です。" :
          errorCode === "decrypt_failed_key_mismatch" ? "暗号化キーが変わっている可能性があります。ID/PWを再保存してください。" :
          "ID/PWを再保存してください。"
        }`,
      });
      return json({ ok: false, steps });
    }

    // Step 2-4: Worker dry-run create/update/cancel
    const sendDryRun = async (kind: "create" | "update" | "cancel") => {
      const payload = {
        job_id: `connection-test-${kind}-${crypto.randomUUID()}`,
        store_id: owner_id,
        location_id: location_id || null,
        reservation_id: null,
        target_channel: "salonboard",
        job_type: kind,
        reservation: { dry_run: true, kind, note: "connection-test" },
        async_callback: false,
      };
      const t0 = Date.now();
      try {
        const res = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/sync-job`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${workerKey}` },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let body: unknown; try { body = JSON.parse(text); } catch { body = text; }
        const latency = Date.now() - t0;
        const success = res.ok && (body as any)?.success !== false;
        const error = success ? undefined : (((body as any)?.message) || `http_${res.status}`);
        await logRow(`dry_run_${kind}`, payload, res.status, body, latency, success, error);
        steps.push({ kind: `dry_run_${kind}`, ok: success, status: res.status, latency_ms: latency, body, error });
        return success;
      } catch (e) {
        const latency = Date.now() - t0;
        const error = e instanceof Error ? e.message : String(e);
        await logRow(`dry_run_${kind}`, payload, null, { error }, latency, false, error);
        steps.push({ kind: `dry_run_${kind}`, ok: false, latency_ms: latency, error });
        return false;
      }
    };

    const okCreate = await sendDryRun("create");
    const okUpdate = okCreate ? await sendDryRun("update") : false;
    const okCancel = okUpdate ? await sendDryRun("cancel") : false;

    const allOk = credsOk && okCreate && okUpdate && okCancel;
    const now = new Date().toISOString();
    if (allOk) {
      await updateIntegration({
        connection_status: "live",
        test_create_passed_at: now,
        test_update_passed_at: now,
        test_cancel_passed_at: now,
        live_enabled_at: now,
        last_error: null,
        last_status: "success",
        last_synced_at: now,
      });
    } else {
      const failed = steps.find((s) => !s.ok);
      await updateIntegration({
        connection_status: "needs_review",
        last_error: `${failed?.kind || "unknown"}: ${failed?.error || "failed"}`,
        last_status: "failed",
      });
    }

    return json({ ok: allOk, steps, connection_status: allOk ? "live" : "needs_review" });
  } catch (e) {
    console.error("salonboard-connection-test error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
