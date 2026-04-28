import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { replyLine, normalizePhone } from "../_shared/line-push.ts";

// LINE署名検証 (HMAC-SHA256)
async function verifySignature(secret: string, body: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return b64 === signature;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") || "";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400, headers: corsHeaders });
  }

  const events = payload?.events ?? [];
  if (!Array.isArray(events) || events.length === 0) {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // destination = LINE公式アカウントのbot user ID。ここからどのサロンか特定する必要がある。
  // 現状はシングルテナント運用前提：line_channel_secret/access_tokenが設定された全プロフィールから判定
  const destination: string | undefined = payload?.destination;

  // チャネルシークレットでサロン特定
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, salon_name, line_channel_access_token, line_channel_secret")
    .not("line_channel_secret", "is", null);

  let owner: any = null;
  if (profiles && profiles.length > 0) {
    for (const p of profiles) {
      if (!p.line_channel_secret) continue;
      const ok = await verifySignature(p.line_channel_secret, rawBody, signature);
      if (ok) { owner = p; break; }
    }
  }

  if (!owner) {
    console.warn("[line-webhook] signature verification failed for destination:", destination);
    // LINE側のVerify用に200を返しても良いが、本番ではセキュリティ上401
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const accessToken = owner.line_channel_access_token;
  if (!accessToken) {
    console.warn("[line-webhook] no access token for owner", owner.id);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  for (const ev of events) {
    try {
      const userId: string | undefined = ev?.source?.userId;
      const replyToken: string | undefined = ev?.replyToken;

      if (ev.type === "follow" && replyToken && userId) {
        await replyLine(
          accessToken,
          replyToken,
          `🌸 ${owner.salon_name || "サロン"}の公式アカウントへようこそ！\n\nご予約や特典のお知らせをお届けします。\n\n📱 はじめに、ご登録のお電話番号をこのトークに送信してください。\n（例：090-1234-5678）\n\n本人確認後、次回からのご予約案内・特典クーポンが届くようになります。`
        );
        continue;
      }

      if (ev.type === "message" && ev.message?.type === "text" && replyToken && userId) {
        const text: string = ev.message.text || "";
        const phone = normalizePhone(text);

        if (!phone) {
          await replyLine(
            accessToken,
            replyToken,
            `お問い合わせありがとうございます🙇‍♀️\n\nLINE連携をご希望の場合は、ご登録のお電話番号を送信してください（例：090-1234-5678）。\n\nそれ以外のお問い合わせはお店までお電話ください。`
          );
          continue;
        }

        // 顧客検索（同じowner配下で電話番号一致）
        // 表記ゆれ対応：DBの値も同じ正規化で比較するため、複数候補取得して照合
        const { data: candidates } = await supabase
          .from("customers")
          .select("id, full_name, phone, line_user_id")
          .eq("owner_id", owner.id)
          .not("phone", "is", null)
          .limit(500);

        const matched = (candidates || []).find(c => normalizePhone(c.phone || "") === phone);

        if (!matched) {
          await replyLine(
            accessToken,
            replyToken,
            `お電話番号が見つかりませんでした🙏\n\nご登録時の番号と異なる可能性があります。お手数ですがお店までご連絡ください。`
          );
          continue;
        }

        if (matched.line_user_id && matched.line_user_id !== userId) {
          // 既に別ユーザーIDで紐付け済み → 上書きはしない
          await replyLine(
            accessToken,
            replyToken,
            `この電話番号は既に別のLINEアカウントと連携されています。\nお店までお問い合わせください🙇‍♀️`
          );
          continue;
        }

        await supabase
          .from("customers")
          .update({ line_user_id: userId })
          .eq("id", matched.id);

        await replyLine(
          accessToken,
          replyToken,
          `✅ ${matched.full_name}様、連携が完了しました！\n\n次回のご予約案内・特典クーポンをこちらのトークでお届けします🌸\n\n${owner.salon_name || "サロン"}`
        );
      }

      if (ev.type === "unfollow" && userId) {
        // ブロック時：line_user_idをクリア（任意）
        await supabase
          .from("customers")
          .update({ line_user_id: null })
          .eq("owner_id", owner.id)
          .eq("line_user_id", userId);
      }
    } catch (e) {
      console.error("[line-webhook] event error:", e);
    }
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});
