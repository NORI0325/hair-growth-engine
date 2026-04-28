// LINE リッチメニュー一発設定（3ボタン：予約 / 特典 / お問合せ）
// オーナー認証必須。設定画面の「リッチメニュー設定」ボタンから呼び出される。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const LINE_API = "https://api.line.me/v2/bot";
const LINE_DATA_API = "https://api-data.line.me/v2/bot";

async function lineFetch(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${LINE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`LINE ${path} ${res.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : {};
}

// 1x1透明PNG（最低限の画像。本番ではきれいな2500x1686画像をアップ推奨だがまず動くことを優先）
// LINEはリッチメニュー画像が必須。サイズ要件：2500x1686 / 2500x843 / 1200x810 / 1200x405 / 800x540 / 800x270
// ここでは2500x843（横3分割）の単色プレースホルダーを生成する代わりに、
// 既存の透明1x1ではエラーになるため、LINEが受け付ける最小の単色2500x843相当の事前生成PNGを使う。
// シンプルに：800x270のグレー背景PNG（小さく軽い、LINE規格内）を埋め込む。
// ここでは画像を外部から取得（lovable preview origin）する代わりに、最小実装として
// data URLからbinary生成する関数を用意。
function makePlaceholderPng(): Uint8Array {
  // 1px x 1px の grayscale PNG (最小)。これは LINE のサイズ要件を満たさず upload で失敗するため
  // 実装方針を変更：画像アップロードは UI から手動で行わせる。
  // この関数は使わない。
  return new Uint8Array();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("salon_name, public_slug, line_channel_access_token, google_review_url")
      .eq("id", user.id)
      .maybeSingle();

    const token = profile?.line_channel_access_token;
    if (!token) {
      return new Response(JSON.stringify({ error: "no_token", message: "先にチャネルアクセストークンを設定してください" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!profile?.public_slug) {
      return new Response(JSON.stringify({ error: "no_slug", message: "サロンの公開URLが未設定です" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://hair-growth-engine.lovable.app";
    const bookingUrl = `${APP_ORIGIN}/r/${profile.public_slug}`;

    // 既存メニュー全削除
    try {
      const list = await lineFetch("/richmenu/list", token, { method: "GET" });
      for (const m of (list?.richmenus || [])) {
        try { await lineFetch(`/richmenu/${m.richMenuId}`, token, { method: "DELETE" }); } catch (_) {}
      }
    } catch (e) {
      console.warn("richmenu list/delete:", e);
    }

    // リッチメニュー作成（800x540を3分割）
    const menuPayload = {
      size: { width: 2500, height: 843 },
      selected: true,
      name: `${profile.salon_name || "サロン"} メニュー`,
      chatBarText: "メニュー",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: { type: "uri", label: "予約する", uri: bookingUrl },
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: { type: "message", label: "特典", text: "特典を見る" },
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: { type: "message", label: "お問合せ", text: "お問合せ" },
        },
      ],
    };

    const created = await lineFetch("/richmenu", token, {
      method: "POST",
      body: JSON.stringify(menuPayload),
    });
    const richMenuId = created.richMenuId;
    if (!richMenuId) throw new Error("richMenuId missing");

    // 画像アップロード：プログラム生成のSVGをPNG化するのは重いので、シンプルな単色背景PNG（事前生成バイト列）
    // 2500x843の1色PNGをcanvasなしで生成 → Denoでは不可。代わりに最小有効PNG（軽量）を作成。
    // 解決策：placehold.co から動的に取得する。
    const placeholderUrl = `https://placehold.co/2500x843/d4af37/000000.png?text=%E4%BA%88%E7%B4%84%20%7C%20%E7%89%B9%E5%85%B8%20%7C%20%E3%81%8A%E5%95%8F%E5%90%88%E3%81%9B`;
    const imgRes = await fetch(placeholderUrl);
    if (!imgRes.ok) throw new Error(`placeholder image fetch failed ${imgRes.status}`);
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());

    const upRes = await fetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: imgBytes,
    });
    if (!upRes.ok) {
      const t = await upRes.text();
      throw new Error(`image upload ${upRes.status}: ${t.slice(0, 300)}`);
    }

    // デフォルト設定
    await lineFetch(`/user/all/richmenu/${richMenuId}`, token, { method: "POST" });

    return new Response(JSON.stringify({ success: true, richMenuId, bookingUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("line-setup-rich-menu error:", e);
    return new Response(JSON.stringify({ error: "failed", message: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
