// 拡張機能ZIPを認証＋アクティブサブスク必須でダウンロードさせる
// マスターファイル流出を防ぐ核心エンドポイント
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TERMS_VERSION = "v1.0-2026-05-04";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(
        JSON.stringify({ error: "ログインが必要です" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 同意フラグを取得（POSTのみ）
    let consentUnofficial = false;
    let consentRiskSelf = false;
    let consentProperUse = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        consentUnofficial = body?.consent_unofficial === true;
        consentRiskSelf = body?.consent_risk_self_responsibility === true;
        consentProperUse = body?.consent_proper_use === true;
      } catch (_) { /* ignore */ }
    }

    if (!consentUnofficial || !consentRiskSelf || !consentProperUse) {
      return new Response(
        JSON.stringify({ error: "免責事項3項目すべてへの同意が必要です", terms_version: TERMS_VERSION }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ユーザー認証
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "認証に失敗しました" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const user = userData.user;

    // サブスクリプション確認（service role で参照）
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: sub } = await admin
      .from("subscriptions")
      .select("status, trial_ends_at, current_period_end")
      .eq("owner_id", user.id)
      .maybeSingle();

    const now = new Date();
    const isActive = (() => {
      if (!sub) return false;
      if (sub.status === "active") return true;
      if (sub.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) return true;
      if (sub.current_period_end && new Date(sub.current_period_end) > now && sub.status !== "canceled") return true;
      return false;
    })();

    if (!isActive) {
      return new Response(
        JSON.stringify({ error: "ご契約が有効ではありません。お支払い設定をご確認ください。" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // テナント取得
    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    // 監査ログ記録
    await admin.from("extension_download_logs").insert({
      user_id: user.id,
      tenant_id: membership?.tenant_id ?? null,
      ip: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
      version: "2.1.3",
    });

    // 公開URLからZIPを取得して返す（公開フォルダから直接読まない＝差し替え可能）
    // ZIPは public/salonboard-exporter.zip に置く前提
    const zipUrl = `${supabaseUrl.replace("/auth/v1", "")}`; // not used
    // 実装: ストレージバケット 'private-extensions' から取得
    const { data: file, error: dlErr } = await admin.storage
      .from("private-extensions")
      .download("salonboard-exporter.zip");

    if (dlErr || !file) {
      return new Response(
        JSON.stringify({ error: "拡張機能ファイルが見つかりません: " + (dlErr?.message || "") }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const buf = await file.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="salon-boost-importer.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("download-extension error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
