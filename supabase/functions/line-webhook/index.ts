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

// JST現在時刻が営業時間外か判定
function checkOutsideBusinessHours(openTime?: string, closeTime?: string): boolean {
  if (!openTime || !closeTime) return false;
  const now = new Date();
  // JST (+09:00)
  const jstMs = now.getTime() + (9 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000);
  const jst = new Date(jstMs);
  const cur = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const [oh, om] = openTime.split(":").map(Number);
  const [ch, cm] = closeTime.split(":").map(Number);
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  return cur < open || cur >= close;
}

function defaultAutoReply(salonName?: string | null, openTime?: string, closeTime?: string): string {
  const hours = openTime && closeTime ? `\n営業時間: ${openTime.slice(0,5)} 〜 ${closeTime.slice(0,5)}` : "";
  return `メッセージありがとうございます🙇‍♀️\n\nただいま営業時間外のため、スタッフからの返信は翌営業時間内にお返しいたします。${hours}\n\nお急ぎの場合や予約の変更・キャンセルは、トーク下部の「予約する」ボタンよりご操作ください🌸\n\n— ${salonName || "サロン"}`;
}

async function generateAutoReplyAI(
  text: string,
  customerName: string,
  salonName: string,
  openTime?: string,
  closeTime?: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  const hoursText = openTime && closeTime ? `${openTime.slice(0,5)}〜${closeTime.slice(0,5)}` : "営業時間内";
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `あなたは${salonName}の品格あるコンシェルジュです。営業時間外に届いたお客様からのLINEに、AIではなく「営業時間外の自動応答」として温かい一次返信を書きます。
- 必ずお客様のお名前で始める
- お客様の話題に短く触れて共感を示す（具体的な約束はしない）
- 「営業時間内に改めてご連絡します」と伝える
- 営業時間（${hoursText}）を明示
- 「お急ぎの場合は予約ボタンから」と一言添える
- 150文字以内、絵文字は1〜2個まで上品に
- 本文のみ出力（前置き・説明禁止）`,
          },
          {
            role: "user",
            content: `お客様名: ${customerName}様\n\n受信メッセージ:\n${text.slice(0, 500)}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.choices?.[0]?.message?.content?.trim();
    return result ? `${result}\n\n— ${salonName}` : null;
  } catch (e) {
    console.error("[auto-reply AI] error:", e);
    return null;
  }
}

// 連携済み顧客向け：会話に応じた温かいAI返答
async function generateLinkedCustomerReply(
  text: string,
  customerName: string,
  salonName: string,
  isOutsideHours: boolean,
  openTime?: string,
  closeTime?: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  const hoursText = openTime && closeTime ? `${openTime.slice(0,5)}〜${closeTime.slice(0,5)}` : "営業時間内";
  const timeContext = isOutsideHours
    ? `現在は営業時間外（営業時間：${hoursText}）。営業時間内に改めてスタッフからご連絡することを伝える。`
    : `現在は営業時間内。スタッフが順次確認するため少しお待ちいただくよう伝える。`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `あなたは${salonName}の品格あるコンシェルジュです。常連のお客様（${customerName}様）からのLINEに、温かく一次返信します。
【状況】${timeContext}
【ルール】
- 必ず「${customerName}様」で始める
- お客様のメッセージ内容に短く触れて共感や感謝を示す
- 予約変更・キャンセルの相談なら「予約する」ボタンへ案内
- 質問や雑談なら、スタッフが確認してご連絡する旨を伝える
- 「こんにちは」「ありがとう」など挨拶には、温かく挨拶を返す
- 100〜140文字、絵文字は1〜2個まで上品に
- 末尾に「— ${salonName}」を付ける
- 本文のみ出力（前置き・説明・「了解しました」等は禁止）`,
          },
          { role: "user", content: text.slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.choices?.[0]?.message?.content?.trim();
    return result || null;
  } catch (e) {
    console.error("[linked reply AI] error:", e);
    return null;
  }
}

// 未連携の挨拶判定（電話番号送信を促す前に温かい一言を返したい）
function isGreetingOrSimpleText(text: string): boolean {
  const t = text.trim();
  if (t.length > 30) return false;
  return /^(こんにちは|こんばんは|おはよう|はじめまして|よろしく|ありがとう|すみません|hello|hi|hey|？|\?|質問|問い合わせ|営業|何時|いつ)/i.test(t);
}

// 重複返信抑制：直近 windowMs 以内に同オーナー×同ユーザーへ同種返信を送ったか
async function wasRecentlyReplied(
  supabase: any,
  ownerId: string,
  lineUserId: string,
  jobType: string,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data } = await supabase
    .from("line_message_log")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("line_user_id", lineUserId)
    .eq("job_type", jobType)
    .gte("created_at", since)
    .limit(1);
  return !!(data && data.length > 0);
}

// ログ記録ヘルパー
async function logLineReply(
  supabase: any,
  ownerId: string,
  customerId: string | null,
  lineUserId: string,
  jobType: string,
  message: string,
  status: "sent" | "failed" = "sent",
  error?: string,
) {
  await supabase.from("line_message_log").insert({
    owner_id: ownerId,
    customer_id: customerId,
    line_user_id: lineUserId,
    job_type: jobType,
    message: message.slice(0, 4000),
    status,
    error: error || null,
  });
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
    .select("id, salon_name, line_channel_access_token, line_channel_secret, open_time, close_time, auto_reply_enabled, auto_reply_message, auto_reply_use_ai")
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
            .select("full_name, last_visit_date, visit_count, total_spent")
            .eq("owner_id", owner.id)
            .eq("line_user_id", userId)
            .maybeSingle();

          if (!cust) {
            await replyLine(accessToken, replyToken,
              `🎁 まずはLINE連携をお願いします\n\nご登録のお電話番号をこのトークに送信してください（例：090-1234-5678）。連携後、特典クーポンをお届けします。`);
            continue;
          }

          // 特典マスターから有効な特典を取得（期限切れを除外、無期限はOK）
          const today = new Date().toISOString().slice(0, 10);
          const { data: incentives } = await supabase
            .from("incentives")
            .select("title, description, terms, value_label, target_segment, valid_until, sort_order")
            .eq("owner_id", owner.id)
            .eq("active", true)
            .or(`valid_until.is.null,valid_until.gte.${today}`)
            .order("sort_order", { ascending: true });

          const name = `${cust.full_name}様`;
          const daysSinceLastVisit = cust.last_visit_date
            ? Math.floor((Date.now() - new Date(cust.last_visit_date).getTime()) / (1000 * 60 * 60 * 24))
            : null;
          const segment = !cust.last_visit_date
            ? "new"
            : daysSinceLastVisit !== null && daysSinceLastVisit <= 90
              ? "active"
              : daysSinceLastVisit !== null && daysSinceLastVisit <= 180
                ? "at_risk"
                : "dormant";
          const isVip = (cust.total_spent ?? 0) >= 150000 || (cust.visit_count ?? 0) >= 15;
          const visibleIncentives = (incentives || [])
            .filter((i) => !i.target_segment || i.target_segment === "all" || i.target_segment === segment || (i.target_segment === "vip" && isVip))
            .slice(0, 5);
          let msg: string;
          if (visibleIncentives.length === 0) {
            msg = `🎁 ${name}\n\n現在配信中の特典はございません。\n新しいクーポンが追加されましたら、こちらのトークでお知らせいたします🌸\n\n— ${owner.salon_name || "サロン"}`;
          } else {
            const lines = visibleIncentives.map((i) => {
              const expiry = i.valid_until ? `（〜${i.valid_until}）` : "";
              const value = i.value_label ? `\n  ${i.value_label}` : "";
              const description = i.description ? `\n  ${i.description}` : "";
              const terms = i.terms ? `\n  ※${i.terms}` : "";
              return `・${i.title}${expiry}${value}${description}${terms}`;
            }).join("\n\n");
            msg = `🎁 ${name}\n\n現在ご利用いただける特典：\n\n${lines}\n\nご予約は「予約する」ボタンからどうぞ🌸\n\n— ${owner.salon_name || "サロン"}`;
          }
          await replyLine(accessToken, replyToken, msg);
          continue;
        }
        if (text === "お問合せ") {
          await replyLine(accessToken, replyToken,
            `お問合せありがとうございます🙇‍♀️\n\nご質問・ご要望はこのトークに直接お送りください。スタッフが営業時間内に確認のうえ返信いたします。\n\n※ ご予約の変更・キャンセルは「予約する」ボタンから行えます。`);
          continue;
        }

        const phone = normalizePhone(text);

        // 既存顧客にline_user_idが既に紐付いているか
        const { data: linkedCustomer } = await supabase
          .from("customers")
          .select("id, full_name")
          .eq("owner_id", owner.id)
          .eq("line_user_id", userId)
          .maybeSingle();

        // 連携済み顧客からのメッセージ、または未連携でも電話番号でないテキスト
        // → 受信トレイに保存し、AI分類をバックグラウンドで実行
        const isPhoneAttempt = !!phone && !linkedCustomer;
        if (!isPhoneAttempt) {
          // displayName取得（未連携時のみ）
          let displayName: string | null = null;
          if (!linkedCustomer) {
            try {
              const pf = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (pf.ok) {
                const j = await pf.json();
                displayName = j?.displayName || null;
              }
            } catch { /* noop */ }
          }

          const { data: inserted } = await supabase
            .from("line_inbound_messages")
            .insert({
              owner_id: owner.id,
              customer_id: linkedCustomer?.id || null,
              line_user_id: userId,
              display_name: displayName || linkedCustomer?.full_name || null,
              message_text: text.slice(0, 2000),
            })
            .select("id")
            .maybeSingle();

          // AI分類を非同期で起動（fire-and-forget）
          if (inserted?.id) {
            const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-classify-inbound`;
            fetch(fnUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ inbound_id: inserted.id }),
            }).catch(e => console.error("[line-webhook] classify kick failed:", e));
          }

          // ============================================================
          // 【連携済み顧客】温かいAI返信（営業時間内/外で文言を切替）
          // ============================================================
          if (linkedCustomer) {
            // 連投抑制：直近5分以内に同種返信を送っていればスキップ
            const recentlyReplied = await wasRecentlyReplied(
              supabase, owner.id, userId, "linked_auto_reply", 5 * 60 * 1000,
            );
            if (recentlyReplied) {
              console.log(`[line-webhook] suppress duplicate reply to ${userId}`);
              continue;
            }

            const isOutsideHours = checkOutsideBusinessHours(owner.open_time, owner.close_time);
            const shouldReply = owner.auto_reply_enabled || isOutsideHours;
            if (!shouldReply) {
              continue; // スタッフが手動で返す前提（営業時間内かつ自動応答OFF）
            }

            let replyMsg: string | null = null;
            if (owner.auto_reply_use_ai !== false) {
              replyMsg = await generateLinkedCustomerReply(
                text,
                linkedCustomer.full_name,
                owner.salon_name || "サロン",
                isOutsideHours,
                owner.open_time,
                owner.close_time,
              );
            }
            const finalReply: string = replyMsg
              || owner.auto_reply_message
              || defaultAutoReply(owner.salon_name, owner.open_time, owner.close_time);

            const r = await replyLine(accessToken, replyToken, replyMsg);
            if (!r.ok) console.error("[line-webhook] linked reply failed:", r.err);
            await logLineReply(
              supabase, owner.id, linkedCustomer.id, userId,
              "linked_auto_reply", replyMsg,
              r.ok ? "sent" : "failed", r.ok ? undefined : r.err,
            );
            continue;
          }

          // ============================================================
          // 【未連携 × テキスト】初回は温かい挨拶、2回目以降は無音
          // ============================================================
          await supabase.from("line_pending_friends").upsert({
            owner_id: owner.id,
            line_user_id: userId,
            display_name: displayName,
            last_message: text.slice(0, 200),
          }, { onConflict: "owner_id,line_user_id" });

          // 連投抑制：30分以内に未連携返信を送っていれば沈黙
          const recentlyGuided = await wasRecentlyReplied(
            supabase, owner.id, userId, "unlinked_guidance", 30 * 60 * 1000,
          );
          if (recentlyGuided) {
            console.log(`[line-webhook] suppress duplicate guidance to ${userId}`);
            continue;
          }

          let guideMsg: string;
          const greetingLike = isGreetingOrSimpleText(text);
          if (greetingLike) {
            const aiReply = await generateLinkedCustomerReply(
              text,
              displayName || "お客様",
              owner.salon_name || "サロン",
              checkOutsideBusinessHours(owner.open_time, owner.close_time),
              owner.open_time,
              owner.close_time,
            );
            guideMsg = aiReply
              ? `${aiReply}\n\n────────\n💡 ご予約履歴の連携をご希望でしたら、ご登録のお電話番号（例：090-1234-5678）をお送りください🌸`
              : `${displayName ? displayName + "様、" : ""}メッセージありがとうございます🌸\n\nスタッフが確認のうえご連絡いたします。\n\n💡 ご予約履歴の連携をご希望でしたら、ご登録のお電話番号（例：090-1234-5678）をお送りください。\n\n— ${owner.salon_name || "サロン"}`;
          } else {
            guideMsg = `${displayName ? displayName + "様、" : ""}メッセージありがとうございます🙇‍♀️\n\nスタッフが内容を確認のうえご連絡いたします。少々お待ちくださいませ🌸\n\n💡 ご予約履歴の連携をご希望の場合は、ご登録のお電話番号をお送りください（例：090-1234-5678）。\n\n— ${owner.salon_name || "サロン"}`;
          }

          const r = await replyLine(accessToken, replyToken, guideMsg);
          if (!r.ok) console.error("[line-webhook] unlinked reply failed:", r.err);
          await logLineReply(
            supabase, owner.id, null, userId,
            "unlinked_guidance", guideMsg,
            r.ok ? "sent" : "failed", r.ok ? undefined : r.err,
          );
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
          // pendingに番号も記録（オーナーが見て手動連携できるよう）
          await supabase.from("line_pending_friends").upsert({
            owner_id: owner.id,
            line_user_id: userId,
            last_message: text.slice(0, 200),
          }, { onConflict: "owner_id,line_user_id" });

          await replyLine(
            accessToken,
            replyToken,
            `お電話番号が見つかりませんでした🙏\n\nお手数ですがお名前もメッセージでお送りいただけますと、スタッフが確認のうえ連携いたします。`
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

        // 連携が成立したのでpending削除
        await supabase
          .from("line_pending_friends")
          .delete()
          .eq("owner_id", owner.id)
          .eq("line_user_id", userId);

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
