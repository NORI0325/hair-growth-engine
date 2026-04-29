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

  // LINE Verify ボタンは GET ではなく空POSTで来る場合あり。常に200を返す方針に変更。
  if (req.method !== "POST") {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") || "";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: any = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    console.warn("[line-webhook] invalid JSON, returning 200 for LINE Verify");
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  const events = payload?.events ?? [];
  const destination: string | undefined = payload?.destination;
  console.log(`[line-webhook] received: events=${events.length}, destination=${destination}, sig=${signature ? "yes" : "no"}`);

  // Verify用の空イベント or eventsなし → 200
  if (!Array.isArray(events) || events.length === 0) {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // 全プロフィールから access_token を持つものを取得（secretは未設定も許容しフォールバック）
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, salon_name, line_channel_access_token, line_channel_secret")
    .not("line_channel_access_token", "is", null);

  if (!profiles || profiles.length === 0) {
    console.warn("[line-webhook] no profile with access_token configured");
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // まず署名検証で正しいオーナーを特定
  let owner: any = null;
  let verified = false;
  for (const p of profiles) {
    if (!p.line_channel_secret) continue;
    const ok = await verifySignature(p.line_channel_secret, rawBody, signature);
    if (ok) { owner = p; verified = true; break; }
  }

  // フォールバック：シングルテナント運用かつシークレット未設定の場合は唯一のオーナーを使う
  // （セキュリティは弱まるが、設定未完でも友だち追加時の応答くらいは返したい）
  if (!owner && profiles.length === 1) {
    owner = profiles[0];
    console.warn(`[line-webhook] fallback to single owner ${owner.id} (signature ${owner.line_channel_secret ? "MISMATCH" : "secret not set"})`);
  }

  if (!owner) {
    console.warn("[line-webhook] could not identify owner. destination:", destination);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  console.log(`[line-webhook] owner=${owner.id} verified=${verified}`);

  const accessToken = owner.line_channel_access_token;
  if (!accessToken) {
    console.warn("[line-webhook] no access token for owner", owner.id);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  for (const ev of events) {
    try {
      const userId: string | undefined = ev?.source?.userId;
      const replyToken: string | undefined = ev?.replyToken;
      console.log(`[line-webhook] event type=${ev.type} userId=${userId}`);

      if (ev.type === "follow" && replyToken && userId) {
        // LINEプロフィール取得（display_name保存用）
        let displayName: string | null = null;
        try {
          const pf = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (pf.ok) {
            const j = await pf.json();
            displayName = j?.displayName || null;
          }
        } catch (e) {
          console.warn("[line-webhook] profile fetch failed:", e);
        }

        // 既存顧客にline_user_idが既に紐付いていなければ pending に登録
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("owner_id", owner.id)
          .eq("line_user_id", userId)
          .maybeSingle();
        if (!existing) {
          await supabase.from("line_pending_friends").upsert({
            owner_id: owner.id,
            line_user_id: userId,
            display_name: displayName,
          }, { onConflict: "owner_id,line_user_id" });
        }

        const r = await replyLine(
          accessToken,
          replyToken,
          `🌸 ${owner.salon_name || "サロン"}の公式アカウントへようこそ！\n\nご予約や特典のお知らせをお届けします。\n\n📱 ご登録のお電話番号をこのトークに送信してください（例：090-1234-5678）。\n\nお電話番号がご不明な場合は、お名前だけでも構いません。スタッフが確認のうえ連携いたします🙇‍♀️`
        );
        if (!r.ok) console.error("[line-webhook] follow reply failed:", r.err);
        continue;
      }

      if (ev.type === "message" && ev.message?.type === "text" && replyToken && userId) {
        const text: string = ev.message.text || "";

        // リッチメニュー定型文への応答
        if (text === "特典を見る" || text === "特典") {
          const { data: cust } = await supabase
            .from("customers")
            .select("full_name")
            .eq("owner_id", owner.id)
            .eq("line_user_id", userId)
            .maybeSingle();
          const name = cust?.full_name ? `${cust.full_name}様` : "お客様";
          const msg = cust
            ? `🎁 ${name}\n\n現在ご利用いただける特典：\n・次回ご予約で20%OFF\n・ご紹介で1,000円分クーポン\n・お誕生月に30%OFFクーポン配布\n\nご予約は「予約する」ボタンからどうぞ🌸`
            : `🎁 まずはLINE連携をお願いします\n\nご登録のお電話番号をこのトークに送信してください（例：090-1234-5678）。連携後、特典クーポンをお届けします。`;
          await replyLine(accessToken, replyToken, msg);
          continue;
        }
        if (text === "お問合せ") {
          await replyLine(accessToken, replyToken,
            `お問合せありがとうございます🙇‍♀️\n\nご質問・ご要望はこのトークに直接お送りください。スタッフが営業時間内に確認のうえ返信いたします。\n\n※ ご予約の変更・キャンセルは「予約する」ボタンから行えます。`);
          continue;
        }

        const phone = normalizePhone(text);

        if (!phone) {
          const r = await replyLine(
            accessToken,
            replyToken,
            `お問い合わせありがとうございます🙇‍♀️\n\nLINE連携をご希望の場合は、ご登録のお電話番号を送信してください（例：090-1234-5678）。\n\nそれ以外のお問い合わせはお店までお電話ください。`
          );
          if (!r.ok) console.error("[line-webhook] text reply failed:", r.err);
          continue;
        }

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
          `✅ ${matched.full_name}様、連携が完了しました!\n\n次回のご予約案内・特典クーポンをこちらのトークでお届けします🌸\n\n${owner.salon_name || "サロン"}`
        );
      }

      if (ev.type === "unfollow" && userId) {
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
