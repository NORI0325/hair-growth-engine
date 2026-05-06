import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { replyLine, sendLinePush, normalizePhone } from "../_shared/line-push.ts";
import { detectFields } from "../_shared/line-field-detector.ts";
import {
  quickReservationIntent,
  parseReservationWithAI,
  buildReservationAutoReply,
  isOutsideBusinessHoursJst,
  todayJstIso,
} from "../_shared/reservation-intent.ts";
import { signActionToken, hashToken, publicAppOrigin } from "../_shared/reservation-token.ts";

// 問い合わせクイックリプライ分類
type InquiryIntent = "booking_change" | "cancel" | "price" | "parking" | "hours" | "staff_consult" | "style_consult" | "other";
type InquiryUrgency = "high" | "normal" | "low";
const INQUIRY_CATEGORIES: { intent: InquiryIntent; label: string; urgency: InquiryUrgency; notify: boolean; reply: string; templateKind: string; autoAnswer?: "hours" | "parking" }[] = [
  { intent: "booking_change", label: "予約変更", urgency: "high", notify: true, templateKind: "inquiry_booking_change",
    reply: "ご予約変更ですね🙇‍♀️\n変更したい日時をお送りください。スタッフが確認のうえご連絡いたします。" },
  { intent: "cancel", label: "キャンセル", urgency: "high", notify: true, templateKind: "inquiry_cancel",
    reply: "キャンセルのご連絡ですね🙇‍♀️\nご予約日時をお送りください。確認のうえご連絡いたします。" },
  { intent: "price", label: "料金確認", urgency: "normal", notify: false, templateKind: "inquiry_price",
    reply: "料金についてのご質問ですね。気になるメニュー名をお送りください🙇‍♀️" },
  { intent: "parking", label: "駐車場", urgency: "low", notify: false, templateKind: "inquiry_parking", autoAnswer: "parking",
    reply: "駐車場情報がまだ登録されていません。お手数ですが、ご来店時にスタッフまでお声がけください🙇‍♀️" },
  { intent: "hours", label: "営業時間", urgency: "low", notify: false, templateKind: "inquiry_hours", autoAnswer: "hours",
    reply: "営業時間情報がまだ登録されていません。\nご予約可能な時間は「予約する」ボタンからご確認いただけます🙇‍♀️" },
  { intent: "staff_consult", label: "担当者相談", urgency: "high", notify: true, templateKind: "inquiry_staff_consult",
    reply: "担当者についてのご相談ですね。ご希望やお悩みをお送りください🙇‍♀️" },
  { intent: "style_consult", label: "髪型相談", urgency: "normal", notify: true, templateKind: "inquiry_style_consult",
    reply: "髪型相談ですね✨\nご希望のイメージや現在のお悩みをお送りください。参考画像があれば一緒に送っていただけると嬉しいです🌸" },
  { intent: "other", label: "その他", urgency: "normal", notify: true, templateKind: "inquiry_other",
    reply: "お問い合わせありがとうございます🙇‍♀️\n内容をお送りください。スタッフが確認のうえご連絡いたします。" },
];

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
  return `メッセージありがとうございます🙇‍♀️\n\nただいま営業時間外のため、担当者からの返信は翌営業時間内にお返しいたします。${hours}\n\nお急ぎの場合や予約の変更・キャンセルは、トーク下部の「予約する」ボタンよりご操作ください🌸\n\n— ${salonName || "サロン"}`;
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
    ? `現在は営業時間外（営業時間：${hoursText}）。営業時間内に改めて担当者からご連絡することを伝える。`
    : `現在は営業時間内。担当者が順次確認するため少しお待ちいただくよう伝える。`;
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
- 質問や雑談なら、担当者が確認してご連絡する旨を伝える
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

// メッセージの種類を判定（ハイブリッド遅延の基本速度を決める）
type MessageKind = "urgent" | "booking" | "question" | "casual";

function classifyMessageKind(text: string): MessageKind {
  const t = text.toLowerCase();
  // 緊急：クレーム・キャンセル・トラブル系
  if (/(キャンセル|cancel|遅れ|遅刻|間に合わ|急ぎ|至急|今日.*行け|行けな|休み|体調|具合|熱|風邪|クレーム|苦情|怒|不満|最悪|ひどい|間違|忘れ|来店できな)/.test(t)) {
    return "urgent";
  }
  // 予約系：日時・予約変更
  if (/(予約|変更|日時|何時|空い|空き|reserv|book|時間|曜日|来週|来月|今度|また|次回)/.test(t)) {
    return "booking";
  }
  // 質問系：?を含む or 質問語
  if (/[?？]|教え|どう|何|いくら|料金|値段|メニュー|やって|できま|可能|ありま/.test(t)) {
    return "question";
  }
  return "casual";
}

// 種類別の自然な遅延（ms）。1通方式・範囲内ランダム + 営業時間外は短めに（埋もれ防止）
function pickReplyDelayMs(kind: MessageKind, isOutsideHours: boolean): {
  mainDelayMs: number;
} {
  const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));
  // 営業時間外は短めに（埋もれ防止）
  if (isOutsideHours) {
    return { mainDelayMs: rand(8_000, 25_000) };
  }
  switch (kind) {
    case "urgent":
      // 緊急：即気づく安心感
      return { mainDelayMs: rand(15_000, 45_000) };
    case "booking":
      // 予約系：予定を確認している感
      return { mainDelayMs: rand(60_000, 180_000) };
    case "question":
      // 質問系：丁寧に考えている感
      return { mainDelayMs: rand(90_000, 240_000) };
    case "casual":
    default:
      // 雑談：ゆったり
      return { mainDelayMs: rand(60_000, 180_000) };
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
  locationId?: string | null,
) {
  await supabase.from("line_message_log").insert({
    owner_id: ownerId,
    location_id: locationId ?? null,
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

  // ============================================================
  // Phase A/B: マルチテナント署名検証
  //   profiles.line_channel_secret （オーナー共通LINE）
  //   locations.line_channel_secret （店舗別LINE公式アカウント）
  //   どちらにも該当しなければ処理せず 200 のみ返す（fallback はオプトインのみ）
  // ============================================================
  const [{ data: profilesAll }, { data: locationsAll }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, salon_name, line_channel_access_token, line_channel_secret, open_time, close_time, auto_reply_enabled, auto_reply_message, auto_reply_use_ai, line_reservation_enabled, notification_recipients")
      .not("line_channel_access_token", "is", null),
    supabase
      .from("locations")
      .select("id, tenant_id, name, line_channel_access_token, line_channel_secret")
      .not("line_channel_secret", "is", null),
  ]);

  const profiles = profilesAll || [];
  const locations = locationsAll || [];

  if (profiles.length === 0 && locations.length === 0) {
    console.warn("[line-webhook] no profile/location with LINE credentials configured");
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // tenant_id → owner_user_id マップ（locations 側で署名一致した時にownerを特定するため）
  let tenantOwnerMap = new Map<string, string>();
  if (locations.length > 0) {
    const tenantIds = Array.from(new Set(locations.map((l: any) => l.tenant_id).filter(Boolean)));
    if (tenantIds.length > 0) {
      const { data: tenants } = await supabase
        .from("tenants").select("id, owner_user_id").in("id", tenantIds);
      tenantOwnerMap = new Map((tenants || []).map((t: any) => [t.id, t.owner_user_id]));
    }
  }

  // 署名検証ループ
  let owner: any = null;            // profiles 行（owner レベル設定）
  let verified = false;
  let webhookLocationId: string | null = null;
  let credentialSource: "owner" | "location" | "fallback" = "owner";
  let accessToken: string | null = null;
  let signedHasSecret = false;

  // 1) location 側で一致を試す（店舗別LINEを優先）
  for (const loc of locations) {
    if (!loc.line_channel_secret) continue;
    const ok = await verifySignature(loc.line_channel_secret, rawBody, signature);
    if (ok) {
      const ownerId = tenantOwnerMap.get(loc.tenant_id);
      if (!ownerId) {
        console.warn(`[line-webhook] location ${loc.id} matched but tenant owner not found`);
        continue;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, salon_name, line_channel_access_token, line_channel_secret, open_time, close_time, auto_reply_enabled, auto_reply_message, auto_reply_use_ai, line_reservation_enabled, notification_recipients")
        .eq("id", ownerId)
        .maybeSingle();
      if (!prof) continue;
      owner = prof;
      verified = true;
      webhookLocationId = loc.id;
      // 店舗別tokenを優先、無ければownerのtokenにfallback（後方互換）
      accessToken = (loc.line_channel_access_token && String(loc.line_channel_access_token).length > 10)
        ? loc.line_channel_access_token
        : prof.line_channel_access_token;
      credentialSource = loc.line_channel_access_token ? "location" : "owner";
      signedHasSecret = true;
      break;
    }
  }

  // 2) profiles 側で一致を試す（オーナー共通LINE）
  if (!owner) {
    for (const p of profiles) {
      if (!p.line_channel_secret) continue;
      const ok = await verifySignature(p.line_channel_secret, rawBody, signature);
      if (ok) {
        owner = p;
        verified = true;
        webhookLocationId = null; // 後段で customer.location_id 等から解決
        accessToken = p.line_channel_access_token;
        credentialSource = "owner";
        signedHasSecret = true;
        break;
      }
    }
  }

  // 3) fallback はオプトインのみ（既存ユーザーが何も変更しなくても動くよう、
  //    profile が1件しかない時は本番でも互換動作させる）
  if (!owner) {
    const allowFallback = (Deno.env.get("ENABLE_LINE_SINGLE_TENANT_FALLBACK") || "true") === "true";
    if (allowFallback && profiles.length === 1 && locations.every((l: any) => !l.line_channel_secret)) {
      owner = profiles[0];
      accessToken = owner.line_channel_access_token;
      credentialSource = "fallback";
      signedHasSecret = !!owner.line_channel_secret;
      console.warn(`[line-webhook] single-tenant fallback to owner=${owner.id} (verified=false, secretConfigured=${signedHasSecret})`);
    }
  }

  if (!owner || !accessToken) {
    console.warn(`[line-webhook] could not identify owner from signature. dest=${destination ? "set" : "none"} sigPresent=${!!signature} profileCount=${profiles.length} locationCount=${locations.length}`);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  console.log(`[line-webhook] resolved owner=${owner.id} verified=${verified} credentialSource=${credentialSource} hasLocationContext=${webhookLocationId ? "yes" : "no"}`);

  // ============================================================
  // location_id 解決ヘルパー
  //   優先順位: 1.webhook署名で確定した location_id  2.顧客.location_id
  //            3.pending/inbound に保存済み  4.owner default location
  //            5. null （駐車場/営業時間/店舗別テンプレ用途では owner 共通へfallback or 未設定案内）
  // ============================================================
  let cachedDefaultLocationId: string | null | undefined = undefined;
  const resolveLocationId = async (customerLocationId?: string | null): Promise<string | null> => {
    if (webhookLocationId) return webhookLocationId;
    if (customerLocationId) return customerLocationId;
    if (cachedDefaultLocationId !== undefined) return cachedDefaultLocationId;
    try {
      const { data: loc } = await supabase
        .rpc("default_location_for_owner", { p_owner_id: owner.id });
      cachedDefaultLocationId = (typeof loc === "string" ? loc : null) || null;
    } catch {
      cachedDefaultLocationId = null;
    }
    return cachedDefaultLocationId;
  };

  for (const ev of events) {
    try {
      const userId: string | undefined = ev?.source?.userId;
      const replyToken: string | undefined = ev?.replyToken;
      console.log(`[line-webhook] event type=${ev.type} userId=${userId}`);

      // ============= 問い合わせクイックリプライ postback =============
      if (ev.type === "postback" && replyToken && userId) {
        const data: string = ev.postback?.data || "";
        if (data.startsWith("inq:")) {
          const intentRaw = data.slice(4);
          const cat = INQUIRY_CATEGORIES.find((c) => c.intent === intentRaw);
          if (cat) {
            // 紐付き顧客を引く
            const { data: cust } = await supabase
              .from("customers")
              .select("id, full_name, location_id")
              .eq("owner_id", owner.id)
              .eq("line_user_id", userId)
              .maybeSingle();

            // テンプレート上書きがあれば優先
            let replyBody = cat.reply;
            let autoAnswered = false;
            try {
              const { data: tpl } = await supabase
                .from("customer_message_templates")
                .select("body")
                .eq("owner_id", owner.id)
                .eq("kind", cat.templateKind)
                .eq("active", true)
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (tpl?.body && tpl.body.trim().length > 0) replyBody = tpl.body;
            } catch (e) { console.warn("[line-webhook] inquiry tpl fetch failed:", e); }

            // 駐車場/営業時間/店舗別テンプレ用の location_id を解決
            //   優先: webhook署名で確定した location > 顧客.location_id
            //   不明なら null（owner共通設定にfallbackし、無ければ未設定案内）
            const inquiryLocationId = await resolveLocationId(cust?.location_id ?? null);

            // 営業時間：DBから即時回答
            if (cat.autoAnswer === "hours") {
              try {
                let hq = supabase.from("salon_hours")
                  .select("weekday, open_time, close_time, closed")
                  .eq("owner_id", owner.id);
                if (inquiryLocationId) hq = hq.eq("location_id", inquiryLocationId);
                else hq = hq.is("location_id", null);
                const { data: rows } = await hq.order("weekday");
                if (rows && rows.length > 0) {
                  const wk = ["日", "月", "火", "水", "木", "金", "土"];
                  const lines = rows.map((r: any) => {
                    const t = r.closed ? "定休日" : `${String(r.open_time).slice(0,5)}〜${String(r.close_time).slice(0,5)}`;
                    return `${wk[r.weekday]}：${t}`;
                  });
                  replyBody = `営業時間はこちらです🌸\n\n${lines.join("\n")}\n\nご予約はトーク下部の「予約する」からお進みください。`;
                  autoAnswered = true;
                }
              } catch (e) { console.warn("[line-webhook] hours fetch failed:", e); }
            }

            // 駐車場：店舗設定から動的に生成
            let parkingUnregistered = false;
            if (cat.autoAnswer === "parking") {
              try {
                let pq = supabase.from("salon_parking_settings")
                  .select("parking_status, parking_spaces, parking_description, parking_map_url, parking_landmark, parking_full_notice, parking_fee_note, parking_reply_template")
                  .eq("owner_id", owner.id);
                if (inquiryLocationId) pq = pq.eq("location_id", inquiryLocationId);
                else pq = pq.is("location_id", null);
                const { data: ps } = await pq.maybeSingle();
                const status = ps?.parking_status ?? "unknown";
                const desc = ps?.parking_description?.trim() || "";
                const mapLine = ps?.parking_map_url ? `\n\nGoogleマップ：\n${ps.parking_map_url}` : "";
                if (ps?.parking_reply_template?.trim()) {
                  replyBody = ps.parking_reply_template.trim();
                  autoAnswered = true;
                } else if (status === "available") {
                  const spaces = ps?.parking_spaces ? `店舗前に${ps.parking_spaces}台分ございます。\n\n` : "";
                  const landmark = ps?.parking_landmark ? `\n\n目印：\n${ps.parking_landmark}` : "";
                  const full = ps?.parking_full_notice ? `\n\n満車の場合：\n${ps.parking_full_notice}` : "";
                  replyBody = `駐車場のご案内です🚗\n\n${spaces}${desc}${landmark}${full}${mapLine}`.replace(/\n{3,}/g, "\n\n").trim();
                  autoAnswered = true;
                } else if (status === "partner") {
                  const fee = ps?.parking_fee_note ? `\n\n駐車料金について：\n${ps.parking_fee_note}` : "";
                  replyBody = `提携駐車場のご案内です🚗\n\n${desc}${fee}${mapLine}`.replace(/\n{3,}/g, "\n\n").trim();
                  autoAnswered = true;
                } else if (status === "none") {
                  replyBody = `専用駐車場はございません🙇‍♀️\nお車でお越しの場合は、近隣のコインパーキングをご利用ください。${desc ? `\n\n${desc}` : ""}${mapLine}`.trim();
                  autoAnswered = true;
                } else {
                  replyBody = `駐車場情報がまだ登録されていません🙇‍♀️\nお急ぎの場合は、このLINEに「駐車場について詳しく」と送ってください。スタッフが確認してご案内いたします。`;
                  parkingUnregistered = true;
                }
              } catch (e) { console.warn("[line-webhook] parking fetch failed:", e); }
            }

            // 受信ログ保存（AI分類はスキップ）
            const effectiveUrgency = parkingUnregistered ? "normal" : cat.urgency;
            const effectiveHandled = autoAnswered;
            const effectiveAction = parkingUnregistered
              ? "駐車場情報が未登録です。店舗設定に駐車場情報を登録してください。必要に応じてお客様へ返信してください。"
              : (autoAnswered ? "自動回答済み" : (cat.urgency === "high" ? "至急ご対応ください" : "営業時間内に確認"));
            await supabase.from("line_inbound_messages").insert({
              owner_id: owner.id,
              location_id: inquiryLocationId,
              customer_id: cust?.id ?? null,
              line_user_id: userId,
              display_name: cust?.full_name || null,
              message_text: `(クイックリプライ選択: ${cat.label})`,
              intent: cat.intent,
              urgency: effectiveUrgency,
              summary: parkingUnregistered ? `お問い合わせ: ${cat.label}（駐車場情報未登録）` : `お問い合わせ: ${cat.label}`,
              suggested_action: effectiveAction,
              ai_processed: true,
              handled: effectiveHandled,
              handled_at: effectiveHandled ? new Date().toISOString() : null,
            });

            // 一次返信
            await replyLine(accessToken, replyToken, replyBody);

            // スタッフ通知（要対応カテゴリのみ）
            if (cat.notify) {
              try {
                const { data: prof } = await supabase
                  .from("profiles")
                  .select("owner_notification_email, salon_name")
                  .eq("id", owner.id)
                  .maybeSingle();
                const notifyTo = prof?.owner_notification_email;
                if (notifyTo) {
                  const urgencyLabel = cat.urgency === "high" ? "🚨 要対応" : "📩 お問い合わせ";
                  await supabase.functions.invoke("send-transactional-email", {
                    body: {
                      to: notifyTo,
                      subject: `${urgencyLabel} LINE: ${cat.label}${cust ? ` - ${cust.full_name}様` : ""}`,
                      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:${cat.urgency === "high" ? "#c0392b" : "#1f6f8b"}">${urgencyLabel} LINE受信通知</h2>
  <p style="color:#555">${prof?.salon_name || "サロン"}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;background:#f5f5f5;width:120px"><b>カテゴリ</b></td><td style="padding:8px">${cat.label}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5"><b>お客様</b></td><td style="padding:8px">${cust?.full_name || "（未連携）"}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5"><b>緊急度</b></td><td style="padding:8px">${cat.urgency}</td></tr>
  </table>
  <p style="font-size:12px;color:#888">受信トレイから返信できます。</p>
</div>`,
                      template_name: "line_inquiry_alert",
                    },
                  });
                }
              } catch (e) { console.error("[line-webhook] inquiry notify failed:", e); }
            }
          }
          continue;
        }
      }

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
          `🌸 ${owner.salon_name || "サロン"}の公式アカウントへようこそ！\n\nご予約や特典のお知らせをお届けします。\n\n📱 ご登録のお電話番号をこのトークに送信してください（例：090-1234-5678）。\n\nお電話番号がご不明な場合は、お名前だけでも構いません。担当者が確認のうえ連携いたします🙇‍♀️`
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
        if (text === "お問合せ" || text === "お問い合わせ") {
          // クイックリプライ8択（postback で intent を受ける）
          const items = INQUIRY_CATEGORIES.map((c) => ({
            type: "action",
            action: { type: "postback", label: c.label, data: `inq:${c.intent}`, displayText: c.label },
          }));
          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              replyToken,
              messages: [{
                type: "text",
                text: `お問合せありがとうございます🙇‍♀️\n\nご用件をお選びください。該当がない場合は「その他」からどうぞ。`,
                quickReply: { items },
              }],
            }),
          }).catch((e) => console.error("[line-webhook] inquiry quickReply failed:", e));
          continue;
        }

        const phone = normalizePhone(text);

        // ============= 個別連携トークン照合 =============
        // フォーマット: "連携:XXXXXXXX" or 単独の8桁英数字
        const tokenMatch = text.match(/(?:連携[:：]?\s*)?\b([A-Z0-9]{8})\b/i);
        if (tokenMatch) {
          const tokenStr = tokenMatch[1].toUpperCase();
          const { data: tokenRow } = await supabase
            .from("customer_line_link_tokens")
            .select("id, customer_id, owner_id, used_at, expires_at")
            .eq("owner_id", owner.id)
            .eq("token", tokenStr)
            .maybeSingle();
          if (tokenRow && !tokenRow.used_at && new Date(tokenRow.expires_at).getTime() > Date.now()) {
            const { data: cust } = await supabase
              .from("customers")
              .select("id, full_name, line_user_id")
              .eq("id", tokenRow.customer_id)
              .maybeSingle();
            if (cust) {
              if (cust.line_user_id && cust.line_user_id !== userId) {
                await replyLine(accessToken, replyToken,
                  `この顧客カードは既に別のLINEアカウントと連携されています。\nお店までお問い合わせください🙇‍♀️`);
                continue;
              }
              await supabase.from("customers")
                .update({ line_user_id: userId, line_unfollowed_at: null })
                .eq("id", cust.id);
              await supabase.from("customer_line_link_tokens")
                .update({ used_at: new Date().toISOString() }).eq("id", tokenRow.id);
              await supabase.from("line_pending_friends")
                .delete().eq("owner_id", owner.id).eq("line_user_id", userId);
              await replyLine(accessToken, replyToken,
                `✅ ${cust.full_name}様、連携が完了しました!\n\n次回のご予約案内・特典クーポンをこちらのトークでお届けします🌸\n\n${owner.salon_name || "サロン"}`);
              continue;
            }
          }
        }

        // 既存顧客にline_user_idが既に紐付いているか（再フォロー時はソフト復活）
        const { data: linkedCustomer } = await supabase
          .from("customers")
          .select("id, full_name, line_unfollowed_at, email, birthday, phone, info_request_last_sent_at, info_request_pending, imported_from, location_id")
          .eq("owner_id", owner.id)
          .eq("line_user_id", userId)
          .maybeSingle();
        if (linkedCustomer?.line_unfollowed_at) {
          await supabase.from("customers")
            .update({ line_unfollowed_at: null }).eq("id", linkedCustomer.id);
        }

        // ============= 多項目自動検出（連携済み顧客） =============
        // 例: "09012345678 tanaka@test.com 1990/5/12" → 全部まとめて反映
        if (linkedCustomer) {
          const detected = detectFields(text);
          const applied: Record<string, any> = {};
          const updates: Record<string, any> = {};

          // メアド: 未登録のみ自動セット（既登録なら確認スキップ＝今回は既存優先）
          if (detected.email && !linkedCustomer.email) {
            updates.email = detected.email;
            applied.email = detected.email;
          }
          // 誕生日: 未登録のみ自動セット
          if (detected.birthday && !linkedCustomer.birthday) {
            // 年なし(2000-MM-DD)の場合、依頼直近30分以内なら採用、それ以外でも年なしは「誕生日依頼」直後のみ採用
            const now = Date.now();
            const lastReq = linkedCustomer.info_request_last_sent_at
              ? new Date(linkedCustomer.info_request_last_sent_at).getTime() : 0;
            const within30min = lastReq > 0 && (now - lastReq) <= 30 * 60 * 1000;
            const pending = (linkedCustomer.info_request_pending || {}) as Record<string, boolean>;
            const yearKnown = !detected.birthday.startsWith("2000-") || /1990|1991|1992|1993|1994|1995|1996|1997|1998|1999|200[0-9]|201[0-9]/.test(text);
            if (yearKnown || (within30min && pending.birthday)) {
              updates.birthday = detected.birthday;
              applied.birthday = detected.birthday;
            }
          }
          // 電話番号: 未登録のみ自動セット
          if (detected.phone && !linkedCustomer.phone) {
            updates.phone = detected.phone;
            applied.phone = detected.phone;
          }
          // 氏名: ゲスト自動作成顧客（imported_from='line_self'）かつ未確定っぽい時は更新
          // 「LINEお客様」で始まる仮氏名 or imported_from='line_self' を判定
          const isGuestSelf = linkedCustomer.imported_from === "line_self";
          const looksPlaceholderName = !linkedCustomer.full_name
            || /^LINE(お客様|ゲスト)/i.test(linkedCustomer.full_name)
            || linkedCustomer.full_name.length <= 2;
          if (detected.name && isGuestSelf && looksPlaceholderName && detected.name !== linkedCustomer.full_name) {
            updates.full_name = detected.name;
            applied.full_name = detected.name;
          }

          if (Object.keys(updates).length > 0) {
            await supabase.from("customers").update(updates).eq("id", linkedCustomer.id);
            await supabase.from("line_field_detections").insert({
              owner_id: owner.id,
              customer_id: linkedCustomer.id,
              line_user_id: userId,
              raw_text: text.slice(0, 500),
              detected,
              applied,
              needs_confirmation: false,
            });
            // 反映確認の返信
            const labels: string[] = [];
            if (applied.email) labels.push(`📧 メール: ${applied.email}`);
            if (applied.birthday) {
              const yearless = String(applied.birthday).startsWith("2000-");
              const display = yearless
                ? String(applied.birthday).slice(5).replace("-", "/")
                : applied.birthday;
              labels.push(`🎂 誕生日: ${display}`);
            }
            if (applied.phone) labels.push(`📞 電話: ${applied.phone}`);
            if (applied.full_name) labels.push(`👤 お名前: ${applied.full_name}様`);
            const greetName = applied.full_name || linkedCustomer.full_name;
            await replyLine(accessToken, replyToken,
              `✅ ${greetName}様、ご登録ありがとうございます🌸\n\n${labels.join("\n")}\n\nお得情報をピンポイントでお届けします。\n\n— ${owner.salon_name || "サロン"}`);
            continue;
          }
        }

        // ============= 🆕 予約意図検出（連携済み顧客のみ）=============
        if (linkedCustomer && owner.line_reservation_enabled !== false) {
          const quick = quickReservationIntent(text);
          if (quick.matched) {
            console.log(`[reservation-intent] quick match score=${quick.score} for "${text.slice(0,50)}"`);
            const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const { data: recentReq } = await supabase
              .from("reservation_requests")
              .select("id")
              .eq("owner_id", owner.id)
              .eq("customer_id", linkedCustomer.id)
              .in("status", ["awaiting_approval", "pending_clarification"])
              .gte("created_at", tenMinAgo)
              .limit(1);

            if (!recentReq || recentReq.length === 0) {
              const { data: pastBookings } = await supabase
                .from("bookings")
                .select("menu, staff_id")
                .eq("customer_id", linkedCustomer.id)
                .order("booking_date", { ascending: false })
                .limit(5);
              const { data: menus } = await supabase
                .from("menu_items")
                .select("name")
                .eq("owner_id", owner.id)
                .eq("active", true)
                .limit(20);
              const { data: staffs } = await supabase
                .from("staff")
                .select("id, name")
                .eq("owner_id", owner.id)
                .eq("active", true);

              const staffMap = new Map((staffs || []).map((s: any) => [s.id, s.name]));
              const pastStaffNames = Array.from(new Set(
                (pastBookings || [])
                  .map((b: any) => b.staff_id ? staffMap.get(b.staff_id) : null)
                  .filter(Boolean)
              )) as string[];

              const parsed = await parseReservationWithAI({
                text,
                customerName: linkedCustomer.full_name,
                todayJst: todayJstIso(),
                pastMenus: (pastBookings || []).map((b: any) => b.menu).filter(Boolean) as string[],
                pastStaffNames,
                availableMenus: (menus || []).map((m: any) => m.name),
                availableStaffs: (staffs || []).map((s: any) => s.name),
              });

              if (parsed && parsed.isReservation && parsed.confidence >= 30) {
                const isOutsideHours = isOutsideBusinessHoursJst(owner.open_time, owner.close_time);
                const desiredStaffId = parsed.desiredStaffName
                  ? (staffs || []).find((s: any) => s.name === parsed.desiredStaffName)?.id
                  : null;

                const { data: rrInserted, error: rrErr } = await supabase
                  .from("reservation_requests")
                  .insert({
                    owner_id: owner.id,
                    customer_id: linkedCustomer.id,
                    line_user_id: userId,
                    display_name: linkedCustomer.full_name,
                    raw_message: text.slice(0, 2000),
                    ai_model: "google/gemini-2.5-flash",
                    ai_confidence: parsed.confidence,
                    ai_parsed: parsed as any,
                    desired_date_candidates: parsed.desiredDateCandidates,
                    desired_menu: parsed.desiredMenu || null,
                    desired_menu_items: parsed.desiredMenuItems || null,
                    desired_staff_id: desiredStaffId || null,
                    desired_staff_name: parsed.desiredStaffName || null,
                    needs_clarification_fields: parsed.needsClarificationFields,
                    status: parsed.confidence >= 50 ? "awaiting_approval" : "pending_clarification",
                    outside_hours_notified: isOutsideHours,
                    auto_reply_sent_at: new Date().toISOString(),
                  })
                  .select("id")
                  .maybeSingle();

                if (rrErr) console.error("[reservation-intent] insert error:", rrErr);
                else console.log(`[reservation-intent] request id=${rrInserted?.id} conf=${parsed.confidence}`);

                // 🆕 AI解析ログを記録（信頼度学習用）
                try {
                  await supabase.from("reservation_ai_logs").insert({
                    owner_id: owner.id,
                    request_id: rrInserted?.id || null,
                    customer_id: linkedCustomer.id,
                    raw_message: text.slice(0, 2000),
                    keyword_score: quick.score,
                    ai_is_reservation: parsed.isReservation,
                    ai_confidence: parsed.confidence,
                    ai_summary: parsed.summary,
                    ai_extracted: {
                      desired_date_candidates: parsed.desiredDateCandidates,
                      desired_menu: parsed.desiredMenu,
                      desired_menu_items: parsed.desiredMenuItems,
                      desired_staff_name: parsed.desiredStaffName,
                      reasoning: parsed.reasoning,
                    },
                    needs_clarification_fields: parsed.needsClarificationFields,
                  });
                } catch (e) {
                  console.error("[reservation-intent] ai log insert failed:", e);
                }

                const replyMsg = buildReservationAutoReply({
                  customerName: linkedCustomer.full_name || "お客様",
                  salonName: owner.salon_name || "サロン",
                  parsed,
                  isOutsideHours,
                  openTime: owner.open_time,
                  closeTime: owner.close_time,
                });
                await replyLine(accessToken, replyToken, replyMsg);
                await logLineReply(
                  supabase, owner.id, linkedCustomer.id, userId,
                  "reservation_pending", replyMsg, "sent",
                );

                // 🆕 スタッフへLINE通知（notification_recipientsに登録された全員へPush）
                if (rrInserted?.id) {
                  try {
                    const recipients = Array.isArray(owner.notification_recipients)
                      ? owner.notification_recipients
                      : [];
                    const lineRecipients = recipients.filter(
                      (r: any) => r?.line_user_id && (r?.channels || ["line"]).includes("line"),
                    );
                    if (lineRecipients.length > 0 && accessToken) {
                      const appOrigin = publicAppOrigin();
                      const dashboardUrl = `${appOrigin}/reservations`;

                      // 🆕 ワンタイムリンク発行（48h）
                      const actionUrls: Record<string, string> = {};
                      try {
                        const actions: Array<"approve"|"propose"|"reject"> = ["approve","propose","reject"];
                        const expiresAt = new Date(Date.now() + 48*60*60*1000).toISOString();
                        for (const act of actions) {
                          const tok = await signActionToken({
                            request_id: rrInserted.id,
                            action: act,
                            owner_id: owner.id,
                          });
                          const tHash = await hashToken(tok);
                          await supabase.from("reservation_action_tokens").insert({
                            request_id: rrInserted.id,
                            owner_id: owner.id,
                            token_hash: tHash,
                            action: act,
                            expires_at: expiresAt,
                          });
                          const path = act === "approve" ? "a" : act === "propose" ? "p" : "r";
                          actionUrls[act] = `${appOrigin}/r/${path}/${tok}`;
                        }
                      } catch (e) {
                        console.error("[reservation-intent] token issue failed:", e);
                      }

                      const dateLine = parsed.desiredDateCandidates?.[0]
                        ? `📅 ${parsed.desiredDateCandidates[0].date || "?"} ${parsed.desiredDateCandidates[0].timeRange || ""}`
                        : "📅 (日時未確定)";
                      const menuLine = parsed.desiredMenu ? `💇 ${parsed.desiredMenu}` : "";
                      const staffLine = parsed.desiredStaffName ? `👤 ${parsed.desiredStaffName}様ご指名` : "";
                      const outsideTag = isOutsideHours ? "【営業時間外受付】\n" : "";
                      const linkBlock = actionUrls.approve
                        ? `\n\n━━━━━━━━━━━\nLINEから直接操作:\n✅ 承認 → ${actionUrls.approve}\n📅 別日時提案 → ${actionUrls.propose}\n❌ 却下 → ${actionUrls.reject}\n（リンク有効期限48時間）`
                        : "";
                      const notifMsg = `${outsideTag}🌸 LINE予約希望が届きました
お客様: ${linkedCustomer.full_name}様
${dateLine}
${menuLine}
${staffLine}

メッセージ:
${text.slice(0, 200)}${text.length > 200 ? "…" : ""}

AI信頼度: ${parsed.confidence}/100
👉 ダッシュボード: ${dashboardUrl}${linkBlock}`;
                      let okCount = 0;
                      for (const r of lineRecipients) {
                        const pr = await sendLinePush(accessToken, r.line_user_id, notifMsg);
                        if (pr.ok) okCount++;
                      }
                      await supabase
                        .from("reservation_requests")
                        .update({
                          staff_notified_at: new Date().toISOString(),
                          staff_notification_status: okCount > 0 ? "sent" : "failed",
                        })
                        .eq("id", rrInserted.id);
                      console.log(`[reservation-intent] staff notified: ${okCount}/${lineRecipients.length}`);
                    }
                  } catch (e) {
                    console.error("[reservation-intent] staff notify failed:", e);
                  }
                }

                continue;
              }
            } else {
              console.log(`[reservation-intent] duplicate within 10min, skip`);
            }
          }
        }

        // ============= ポイント残高照会キーワード =============
        // 「ポイント」「残高」「pt」を含むメッセージで、連携済み顧客に残高を返信
        if (linkedCustomer && /ポイント|残高|\bpt\b|ポイントは/i.test(text)) {
          const { data: ptData } = await supabase
            .from("point_transactions")
            .select("points")
            .eq("customer_id", linkedCustomer.id);
          const balance = (ptData || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
          const { data: items } = await supabase
            .from("point_redemption_items")
            .select("name, points_cost")
            .eq("owner_id", owner.id)
            .eq("active", true)
            .order("points_cost", { ascending: true })
            .limit(5);
          const itemsText = (items || []).length > 0
            ? "\n\n🎁 交換できるアイテム:\n" + (items || []).map((i: any) =>
                `${i.points_cost >= balance ? "🔒" : "✅"} ${i.points_cost.toLocaleString()}pt ${i.name}`).join("\n")
            : "";
          await replyLine(accessToken, replyToken,
            `${linkedCustomer.full_name}様の現在のポイント残高\n\n💎 ${balance.toLocaleString()} pt${itemsText}\n\nマイページで交換できます🌸`);
          continue;
        }

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

          const inboundLocationId = await resolveLocationId((linkedCustomer as any)?.location_id ?? null);
          const { data: inserted } = await supabase
            .from("line_inbound_messages")
            .insert({
              owner_id: owner.id,
              location_id: inboundLocationId,
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
          // 【連携済み顧客】1通方式・自然なランダム遅延
          //   ① メッセージ種類で基本速度を決定（緊急/予約/質問/雑談）
          //   ② ランダム遅延で「人らしい揺らぎ」を表現
          // ============================================================
          if (linkedCustomer) {
            // 二重送信防止：直近20秒以内に返信済みならスキップ（LINE再送対策）
            const recentlyReplied = await wasRecentlyReplied(
              supabase, owner.id, userId, "linked_auto_reply", 20 * 1000,
            );
            if (recentlyReplied) {
              console.log(`[line-webhook] suppress duplicate reply (within 20s) to ${userId}`);
              continue;
            }

            const isOutsideHours = checkOutsideBusinessHours(owner.open_time, owner.close_time);
            const shouldReply = owner.auto_reply_enabled || isOutsideHours;
            if (!shouldReply) {
              continue; // 営業時間内かつ自動応答OFF：担当者が手動で対応
            }

            const kind = classifyMessageKind(text);
            const { mainDelayMs } = pickReplyDelayMs(kind, isOutsideHours);
            console.log(`[line-webhook] reply plan kind=${kind} delay=${mainDelayMs}ms outside=${isOutsideHours}`);

            // 重複防止ログを先に入れて、後続のwebhookで弾けるように
            await logLineReply(
              supabase, owner.id, linkedCustomer.id, userId,
              "linked_auto_reply", `[planned ${kind}]`,
              "sent",
            );

            const customerName = linkedCustomer.full_name || "お客様";
            const salonName = owner.salon_name || "サロン";

            // バックグラウンド処理：遅延 → 本回答（1通方式）
            const task = (async () => {
              try {
                if (mainDelayMs > 0) await new Promise(r => setTimeout(r, mainDelayMs));

                // 本回答（AI生成 → フォールバック）
                let replyMsg: string | null = null;
                if (owner.auto_reply_use_ai !== false) {
                  replyMsg = await generateLinkedCustomerReply(
                    text, customerName, salonName,
                    isOutsideHours, owner.open_time, owner.close_time,
                  );
                }
                const finalReply: string = replyMsg
                  || owner.auto_reply_message
                  || defaultAutoReply(salonName, owner.open_time, owner.close_time);

                const r = await sendLinePush(accessToken, userId, finalReply);
                if (!r.ok) console.error("[line-webhook] linked main reply failed:", r.err);
                await logLineReply(
                  supabase, owner.id, linkedCustomer.id, userId,
                  "linked_main_reply", finalReply,
                  r.ok ? "sent" : "failed", r.ok ? undefined : r.err,
                );
              } catch (e) {
                console.error("[line-webhook] reply task error:", e);
              }
            })();

            // Edge Functionの応答後もタスクを継続させる
            // @ts-ignore - EdgeRuntime is provided by Supabase
            if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
              // @ts-ignore
              EdgeRuntime.waitUntil(task);
            }
            continue;
          }

          // ============= 未連携：氏名のみ完全一致1件で自動連携 =============
          // 漢字/カタカナの氏名トークン抽出 → customers.full_name と完全一致するものを探す
          const detected = detectFields(text);
          if (detected.name && !detected.phone && !detected.email) {
            const { data: nameMatches } = await supabase
              .from("customers")
              .select("id, full_name, line_user_id")
              .eq("owner_id", owner.id)
              .eq("full_name", detected.name)
              .is("line_user_id", null)
              .limit(2);
            if (nameMatches && nameMatches.length === 1) {
              const m = nameMatches[0];
              await supabase.from("customers")
                .update({ line_user_id: userId, line_unfollowed_at: null })
                .eq("id", m.id);
              await supabase.from("line_pending_friends")
                .delete().eq("owner_id", owner.id).eq("line_user_id", userId);
              await supabase.from("line_field_detections").insert({
                owner_id: owner.id,
                customer_id: m.id,
                line_user_id: userId,
                raw_text: text.slice(0, 500),
                detected,
                applied: { name_link: detected.name },
                needs_confirmation: false,
              });
              await replyLine(accessToken, replyToken,
                `✅ ${m.full_name}様、連携が完了しました🌸\n\n次回のご予約案内・特典クーポンをこちらのトークでお届けします。\n\n— ${owner.salon_name || "サロン"}`);
              continue;
            }
            if (nameMatches && nameMatches.length > 1) {
              // 同姓同名複数 → 手動レビュー
              await supabase.from("line_pending_friends").upsert({
                owner_id: owner.id,
                line_user_id: userId,
                display_name: displayName,
                last_message: `[name dup: ${detected.name}]`,
              }, { onConflict: "owner_id,line_user_id" });
              await replyLine(accessToken, replyToken,
                `${detected.name}様、ありがとうございます🙇‍♀️\n同じお名前のお客様が複数いらっしゃるため、お電話番号もお送りいただけますか？\n（例：090-1234-5678）`);
              continue;
            }
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
              : `${displayName ? displayName + "様、" : ""}メッセージありがとうございます🌸\n\n担当者が確認のうえご連絡いたします。\n\n💡 ご予約履歴の連携をご希望でしたら、ご登録のお電話番号（例：090-1234-5678）をお送りください。\n\n— ${owner.salon_name || "サロン"}`;
          } else {
            guideMsg = `${displayName ? displayName + "様、" : ""}メッセージありがとうございます🙇‍♀️\n\n担当者が内容を確認のうえご連絡いたします。少々お待ちくださいませ🌸\n\n💡 ご予約履歴の連携をご希望の場合は、ご登録のお電話番号をお送りください（例：090-1234-5678）。\n\n— ${owner.salon_name || "サロン"}`;
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

        // 電話番号マスク（ログ用）
        const phoneMasked = phone.length >= 11
          ? `${phone.slice(0, 3)}-****-${phone.slice(-4)}`
          : phone.length >= 10
          ? `${phone.slice(0, 3)}-***-${phone.slice(-4)}`
          : `***${phone.slice(-4)}`;
        const rawEventId: string | undefined = ev?.webhookEventId || ev?.message?.id;
        const salonName = owner.salon_name || "サロン";

        // 登録ログヘルパー
        const logRegistration = async (params: {
          action: string;
          success: boolean;
          customer_id?: string | null;
          location_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
        }) => {
          try {
            await supabase.from("line_registration_logs").insert({
              owner_id: owner.id,
              location_id: params.location_id ?? null,
              customer_id: params.customer_id ?? null,
              line_user_id: userId,
              phone_masked: phoneMasked,
              action: params.action,
              success: params.success,
              error_code: params.error_code ?? null,
              error_message: params.error_message ?? null,
              raw_event_id: rawEventId ?? null,
            });
          } catch (e) {
            console.error("[line-webhook] log insert failed:", e);
          }
        };

        // ============= DB側で電話番号正規化マッチ =============
        const { data: phoneMatches, error: rpcErr } = await supabase
          .rpc("find_customer_by_normalized_phone", {
            p_owner_id: owner.id,
            p_phone: phone,
          });

        if (rpcErr) {
          console.error("[line-webhook] phone rpc failed:", rpcErr);
          await logRegistration({
            action: "failed",
            success: false,
            error_code: rpcErr.code || "rpc_error",
            error_message: rpcErr.message,
          });
          await replyLine(accessToken, replyToken,
            `ご登録処理でエラーが発生しました。お手数ですが、しばらくしてから再度お試しください。`);
          continue;
        }

        const matchList = (phoneMatches || []) as Array<{
          id: string; full_name: string; phone: string;
          line_user_id: string | null; location_id: string | null;
        }>;

        // ── 同一電話番号が複数顧客にヒット → 要スタッフ確認 ──
        if (matchList.length > 1) {
          await supabase.from("line_pending_friends").upsert({
            owner_id: owner.id,
            line_user_id: userId,
            last_message: `[duplicate phone: ${matchList.length} matches]`,
          }, { onConflict: "owner_id,line_user_id" });
          await logRegistration({
            action: "needs_review",
            success: false,
            error_code: "duplicate_phone",
            error_message: `${matchList.length} customers share this phone`,
          });
          await replyLine(accessToken, replyToken,
            `確認が必要なため、担当者が確認のうえご連絡いたします。`);
          continue;
        }

        const matched = matchList[0];

        // ── 既存顧客あり ──
        if (matched) {
          // 既に同じLINE userIdが紐付いている → 成功扱い（重複登録なし）
          if (matched.line_user_id === userId) {
            await supabase.from("line_pending_friends")
              .delete().eq("owner_id", owner.id).eq("line_user_id", userId);
            await logRegistration({
              action: "already_linked",
              success: true,
              customer_id: matched.id,
              location_id: matched.location_id,
            });
            await replyLine(accessToken, replyToken,
              `ご登録情報を確認しました。今後はこちらのLINEからご予約・お問い合わせいただけます。\n\n— ${salonName}`);
            continue;
          }

          // 別のLINEアカウントが既に紐付いている → 要スタッフ確認（自動更新しない）
          if (matched.line_user_id && matched.line_user_id !== userId) {
            await supabase.from("line_pending_friends").upsert({
              owner_id: owner.id,
              line_user_id: userId,
              last_message: `[phone collides w/ other line_user]`,
            }, { onConflict: "owner_id,line_user_id" });
            await logRegistration({
              action: "needs_review",
              success: false,
              customer_id: matched.id,
              location_id: matched.location_id,
              error_code: "line_user_conflict",
              error_message: "phone matches a customer already linked to another LINE user",
            });
            await replyLine(accessToken, replyToken,
              `確認が必要なため、担当者が確認のうえご連絡いたします。`);
            continue;
          }

          // line_user_id 未設定 → 紐付け
          const { error: updErr } = await supabase
            .from("customers")
            .update({ line_user_id: userId, line_unfollowed_at: null })
            .eq("id", matched.id);

          if (updErr) {
            await logRegistration({
              action: "failed",
              success: false,
              customer_id: matched.id,
              location_id: matched.location_id,
              error_code: updErr.code || "update_failed",
              error_message: updErr.message,
            });
            await replyLine(accessToken, replyToken,
              `ご登録処理でエラーが発生しました。お手数ですが、しばらくしてから再度お試しください。`);
            continue;
          }

          await supabase.from("line_pending_friends")
            .delete().eq("owner_id", owner.id).eq("line_user_id", userId);
          await logRegistration({
            action: "link_existing_customer",
            success: true,
            customer_id: matched.id,
            location_id: matched.location_id,
          });
          await replyLine(accessToken, replyToken,
            `${matched.full_name}様、ご登録情報を確認しました。\n今後はこちらのLINEからご予約・お問い合わせいただけます。\n\n— ${salonName}`);
          continue;
        }

        // ── 既存顧客なし → 新規ゲスト顧客作成 ──
        // 既に同一 line_user_id で作成済みなら再作成しない
        const { data: existingByLine } = await supabase
          .from("customers")
          .select("id, full_name, location_id")
          .eq("owner_id", owner.id)
          .eq("line_user_id", userId)
          .maybeSingle();

        if (existingByLine?.id) {
          await logRegistration({
            action: "already_linked",
            success: true,
            customer_id: existingByLine.id,
            location_id: existingByLine.location_id,
          });
          await replyLine(accessToken, replyToken,
            `ご登録情報を確認しました。今後はこちらのLINEからご予約・お問い合わせいただけます。\n\n— ${salonName}`);
          continue;
        }

        let displayName: string | null = null;
        try {
          const pf = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (pf.ok) {
            const j = await pf.json();
            displayName = j?.displayName || null;
          }
        } catch { /* noop */ }

        // デフォルト店舗を解決
        let defaultLocationId: string | null = null;
        try {
          const { data: loc } = await supabase
            .rpc("default_location_for_owner", { p_owner_id: owner.id });
          defaultLocationId = (typeof loc === "string" ? loc : null) || null;
        } catch (e) {
          console.warn("[line-webhook] default_location resolve failed:", e);
        }

        const placeholderName = displayName ? `${displayName}様（LINE）` : "LINEお客様";
        const { data: created, error: insErr } = await supabase
          .from("customers")
          .insert({
            owner_id: owner.id,
            location_id: defaultLocationId,
            full_name: placeholderName,
            phone: phone,
            line_user_id: userId,
            imported_from: "line_self",
            is_test: false,
          })
          .select("id, full_name, location_id")
          .maybeSingle();

        if (insErr) {
          // unique violation 23505 → 競合発生時は既存顧客検索→紐付けにフォールバック
          if ((insErr as any).code === "23505") {
            const { data: again } = await supabase
              .rpc("find_customer_by_normalized_phone", {
                p_owner_id: owner.id, p_phone: phone,
              });
            const fb = ((again || []) as any[])[0];
            if (fb) {
              if (fb.line_user_id && fb.line_user_id !== userId) {
                await logRegistration({
                  action: "needs_review",
                  success: false,
                  customer_id: fb.id,
                  location_id: fb.location_id,
                  error_code: "23505_then_line_conflict",
                  error_message: insErr.message,
                });
                await replyLine(accessToken, replyToken,
                  `確認が必要なため、担当者が確認のうえご連絡いたします。`);
                continue;
              }
              await supabase.from("customers")
                .update({ line_user_id: userId, line_unfollowed_at: null })
                .eq("id", fb.id);
              await supabase.from("line_pending_friends")
                .delete().eq("owner_id", owner.id).eq("line_user_id", userId);
              await logRegistration({
                action: "link_existing_customer",
                success: true,
                customer_id: fb.id,
                location_id: fb.location_id,
                error_code: "23505_recovered",
              });
              await replyLine(accessToken, replyToken,
                `${fb.full_name}様、ご登録情報を確認しました。\n今後はこちらのLINEからご予約・お問い合わせいただけます。\n\n— ${salonName}`);
              continue;
            }
          }
          console.error("[line-webhook] guest customer create failed:", insErr);
          await logRegistration({
            action: "failed",
            success: false,
            location_id: defaultLocationId,
            error_code: (insErr as any).code || "insert_failed",
            error_message: insErr.message,
          });
          await replyLine(accessToken, replyToken,
            `ご登録処理でエラーが発生しました。お手数ですが、しばらくしてから再度お試しください。`);
          continue;
        }

        await supabase.from("line_pending_friends")
          .delete().eq("owner_id", owner.id).eq("line_user_id", userId);
        await logRegistration({
          action: "create_customer",
          success: true,
          customer_id: created?.id || null,
          location_id: created?.location_id || defaultLocationId,
        });
        await replyLine(accessToken, replyToken,
          `ご登録ありがとうございます。お電話番号を確認しました。\nお手数ですが、お名前（フルネーム）をメッセージでお送りください。\n例：山田 花子\n\n— ${salonName}`);
      }

      if (ev.type === "unfollow" && userId) {
        // ソフト削除：line_user_idは残し、unfollow時刻を記録（再フォロー時に履歴継続）
        await supabase
          .from("customers")
          .update({ line_unfollowed_at: new Date().toISOString() })
          .eq("owner_id", owner.id)
          .eq("line_user_id", userId);
      }
    } catch (e) {
      console.error("[line-webhook] event error:", e);
    }
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});
