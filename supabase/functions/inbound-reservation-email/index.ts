// Resend Inbound Email Webhook受信エンドポイント
// 外部予約サイト（ホットペッパー / minimo / 楽天Beauty）の通知メールを
// AI解析して customers / bookings に自動登録する
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

// 日本語メールの文字コード自動判定 & デコード
// SALON BOARD等は ISO-2022-JP で送信される。文字化けしたままAIに渡すとハルシネーションの温床。
function decodeJapaneseIfNeeded(input: string): string {
  if (!input) return input;
  // ISO-2022-JP のエスケープシーケンスが含まれる場合
  if (input.includes("\x1B$B") || input.includes("\x1b$B") || input.includes("$B") && input.includes("(B")) {
    try {
      // 文字列を一旦バイト列として解釈し直す（Latin-1 として byte-preserving）
      const bytes = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
      const decoded = new TextDecoder("iso-2022-jp", { fatal: false }).decode(bytes);
      // 化け文字（U+FFFD）が多すぎる場合はオリジナルを返す
      const replacementCount = (decoded.match(/\uFFFD/g) || []).length;
      if (replacementCount < decoded.length * 0.05) return decoded;
    } catch (e) { console.warn("ISO-2022-JP decode failed:", e); }
  }
  return input;
}

// charsetを明示指定して再デコード
function decodeWithCharset(input: string, charset: string): string {
  if (!input || !charset) return input;
  const cs = charset.toLowerCase().replace(/[_-]/g, "");
  const map: Record<string, string> = {
    "iso2022jp": "iso-2022-jp",
    "shiftjis": "shift_jis",
    "sjis": "shift_jis",
    "windows31j": "shift_jis",
    "eucjp": "euc-jp",
    "utf8": "utf-8",
  };
  const target = map[cs] || charset.toLowerCase();
  if (target === "utf-8") return input;
  try {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
    return new TextDecoder(target, { fatal: false }).decode(bytes);
  } catch (e) {
    console.warn(`decode ${target} failed:`, e);
    return input;
  }
}

// Resend Inbound API から本文を取得（webhookにはメタデータしか含まれないため）
async function fetchInboundEmailBody(emailId: string): Promise<{ text: string; html: string; subject: string; from: string; to: string[] } | null> {
  if (!RESEND_API_KEY || !emailId) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/inbound/${emailId}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!res.ok) {
      console.error("Resend inbound fetch failed:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    // headersから charset を抽出
    let charset = "";
    const headers = data.headers || {};
    const ct = headers["Content-Type"] || headers["content-type"] || "";
    const m = String(ct).match(/charset=["']?([\w-]+)/i);
    if (m) charset = m[1];

    let text = data.text || "";
    let html = data.html || "";
    let subject = data.subject || "";

    if (charset) {
      text = decodeWithCharset(text, charset);
      html = decodeWithCharset(html, charset);
      subject = decodeWithCharset(subject, charset);
    }
    // 補助: ISO-2022-JPエスケープが残っていれば追加デコード
    text = decodeJapaneseIfNeeded(text);
    html = decodeJapaneseIfNeeded(html);
    subject = decodeJapaneseIfNeeded(subject);

    return {
      text,
      html,
      subject,
      from: typeof data.from === "string" ? data.from : (data.from?.email || ""),
      to: Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []),
    };
  } catch (e) {
    console.error("Resend inbound fetch exception:", e);
    return null;
  }
}

// 受信先アドレスからソースとinbound_keyを判定
// 例: hp-sb-a8f3k2@inbound.saronboost.com → source=hotpepper, key=sb-a8f3k2
function parseInboundAddress(toAddress: string): { source: string; inboundKey: string } | null {
  const local = toAddress.split("@")[0]?.toLowerCase().trim();
  if (!local) return null;
  // プレフィックス: hp / mn / rb
  const m = local.match(/^(hp|mn|rb|sb)-(.+)$/);
  if (!m) return null;
  const sourceMap: Record<string, string> = { hp: "hotpepper", mn: "minimo", rb: "rakuten_beauty", sb: "salonboard" };
  return { source: sourceMap[m[1]], inboundKey: m[2] };
}

// 件名+本文からソースを補強推定（受信ドメインで判別できない場合の保険）
function inferSourceFromContent(subject: string, text: string, fallback: string): string {
  const haystack = `${subject}\n${text}`.toLowerCase();
  if (haystack.includes("salon board") || haystack.includes("salonboard") || haystack.includes("サロンボード")) return "salonboard";
  if (haystack.includes("ホットペッパー") || haystack.includes("hotpepper") || haystack.includes("hot pepper")) return "hotpepper";
  if (haystack.includes("minimo") || haystack.includes("ミニモ")) return "minimo";
  if (haystack.includes("楽天ビューティ") || haystack.includes("rakuten beauty")) return "rakuten_beauty";
  return fallback;
}

// 冪等キーの計算: 配信ID優先、なければ raw内容のSHA-256
async function computeIdempotencyKey(inboundMessageId: string | null, from: string, subject: string, text: string): Promise<string> {
  if (inboundMessageId) return `mid:${inboundMessageId}`;
  const enc = new TextEncoder().encode([from, subject, text.slice(0, 4000)].join("\n"));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `hash:${hex}`;
}

// 配信ID抽出 (Resend / Mailgun / ImprovMX いずれにも対応)
function extractInboundMessageId(data: any, headers: Record<string, string>): string | null {
  return (
    data.email_id || data.id || data.message_id || data["Message-Id"] ||
    headers["message-id"] || headers["Message-Id"] || headers["X-Mailgun-Message-Id"] || null
  ) || null;
}

async function aiExtractReservation(source: string, subject: string, text: string) {
  const systemPrompt = `あなたは美容室の予約通知メールから情報を構造化抽出するエキスパートです。
受信元: ${source}

【厳格ルール】
- 本文に明示的に書かれている情報のみを抽出してください
- 推測・補完・創作は絶対にしないでください。不明な値は必ず null を返す
- 文字化け・判読不能な部分は null とし、extraction_confidence を "low" にしてください
- 顧客氏名は本文の「氏名」「お客様名」欄から正確にコピーしてください（部分でも創作しない）
- 文字化け（\\x1B$B のようなエスケープ、意味不明な記号列が多い）の場合は extraction_confidence=low`;

  const userPrompt = `以下の予約通知メールから情報を抽出してください。

【件名】
${subject}

【本文】
${text.slice(0, 8000)}`;

  const tools = [{
    type: "function",
    function: {
      name: "extract_reservation",
      description: "予約情報を構造化して返す",
      parameters: {
        type: "object",
        properties: {
          is_reservation: { type: "boolean", description: "これが新規予約通知か（キャンセル・問い合わせはfalse）" },
          event_type: { type: "string", enum: ["created", "cancelled", "changed", "other"], description: "イベント種別" },
          extraction_confidence: { type: "string", enum: ["high", "low"], description: "本文が明瞭で確実に抽出できたか" },
          customer_name: { type: "string", description: "顧客氏名（本文に明示されているもののみ。文字化けしていれば null）" },
          customer_kana: { type: "string", description: "顧客カナ" },
          customer_phone: { type: "string", description: "電話番号（ハイフンなしの数字のみ）" },
          customer_email: { type: "string", description: "顧客メール" },
          booking_date: { type: "string", description: "予約日 YYYY-MM-DD" },
          booking_time: { type: "string", description: "予約時刻 HH:MM" },
          menu: { type: "string", description: "メニュー名" },
          staff_name: { type: "string", description: "担当スタッフ名（本文に明示されているもののみ。未記載なら null）" },
          revenue: { type: "number", description: "予約金額（税込円）" },
          external_reservation_id: { type: "string", description: "サイト固有の予約番号" },
          notes: { type: "string", description: "備考・要望" },
        },
        required: ["is_reservation", "event_type", "extraction_confidence"],
        additionalProperties: false,
      },
    },
  }];

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "extract_reservation" } },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI did not return structured output");
  return JSON.parse(args);
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  return digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Content-Typeに応じてpayloadを解釈
  // - JSON: Resend Inbound webhook
  // - multipart/form-data or x-www-form-urlencoded: ImprovMX / Mailgun webhook
  let payload: any = {};
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  let rawBodyForLog = "";
  try {
    if (contentType.includes("application/json")) {
      const txt = await req.text();
      rawBodyForLog = txt.slice(0, 8000);
      payload = txt ? JSON.parse(txt) : {};
    } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      const obj: Record<string, any> = {};
      for (const [k, v] of form.entries()) {
        obj[k] = typeof v === "string" ? v : (v as File).name;
      }
      payload = obj;
      rawBodyForLog = JSON.stringify(obj).slice(0, 8000);
    } else {
      // 未知Content-Type: テキストとして読み、JSONを試行→失敗時は生テキストを保持
      const txt = await req.text();
      rawBodyForLog = txt.slice(0, 8000);
      try { payload = JSON.parse(txt); } catch { payload = { _raw: txt }; }
    }
  } catch (e) {
    console.error("payload parse error", e, "content-type:", contentType);
    await supabase.from("external_reservation_logs").insert({
      source: "unknown", raw_to: "", raw_from: "", raw_subject: "",
      raw_text: `[parse_error] content-type=${contentType}\n${rawBodyForLog}`,
      status: "failed", error: `parse_error: ${(e as Error).message}`,
    });
    return new Response(JSON.stringify({ error: "invalid body", contentType }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  console.log("inbound payload keys:", Object.keys(payload), "content-type:", contentType);

  // Webhook payload正規化
  // 対応: Resend Inbound (data.to/from) / ImprovMX (To, From, Subject) / Mailgun (recipient, sender)
  const data = payload.data || payload;
  const pickStr = (...vals: any[]): string => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (Array.isArray(v) && v.length) {
        const first = v[0];
        if (typeof first === "string" && first.trim()) return first.trim();
        if (first?.email) return String(first.email);
        if (first?.address) return String(first.address);
      }
      if (v && typeof v === "object") {
        if (v.email) return String(v.email);
        if (v.address) return String(v.address);
      }
    }
    return "";
  };
  const to = pickStr(data.to, data.To, data.envelope?.to, data.recipient, data["X-Original-To"]);
  const from = pickStr(data.from, data.From, data.sender, data.envelope?.from);
  let subject: string = pickStr(data.subject, data.Subject, data.headers?.Subject);

  // 本文抽出: text → html(タグ除去) → body_plain → body_html → 全payloadフォールバック
  const htmlToText = (html: string) => html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let text = "";
  if (typeof data.text === "string" && data.text.trim()) {
    text = data.text;
  } else if (typeof data["body-plain"] === "string" && data["body-plain"].trim()) {
    text = data["body-plain"]; // Mailgun形式
  } else if (typeof data.html === "string" && data.html.trim()) {
    text = htmlToText(data.html);
  } else if (typeof data["body-html"] === "string" && data["body-html"].trim()) {
    text = htmlToText(data["body-html"]);
  } else if (typeof data["stripped-text"] === "string" && data["stripped-text"].trim()) {
    text = data["stripped-text"];
  }

  // それでも空なら、payload全体をJSON化してフォールバック（AIに最低限の情報を渡す）
  if (!text || text.trim().length < 20) {
    try {
      const fallback = JSON.stringify(data).slice(0, 6000);
      text = (text ? text + "\n\n" : "") + "[RAW_PAYLOAD]\n" + fallback;
    } catch { /* ignore */ }
  }

  // Resend Inbound では本文がwebhookに含まれないため、email_idがあればAPIで本文取得
  const emailId: string | undefined = data.email_id || data.id;
  if ((!text || text.replace(/\[RAW_PAYLOAD\][\s\S]*$/, "").trim().length < 20) && emailId) {
    const fetched = await fetchInboundEmailBody(emailId);
    if (fetched) {
      const body = fetched.text?.trim() || (fetched.html ? htmlToText(fetched.html) : "");
      if (body) text = body;
      // メタデータも上書き（webhookに無い場合の保険）
      if (!subject && fetched.subject) subject = fetched.subject;
    }
  }

  // 文字コード判定 & デコード（ISO-2022-JPなど）
  text = decodeJapaneseIfNeeded(text);
  subject = decodeJapaneseIfNeeded(subject);

  // === 冪等キー計算 (重複Webhook防止) ===
  const headersObj: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.headers || {})) {
    headersObj[String(k)] = String(v ?? "");
  }
  const inboundMessageId = extractInboundMessageId(data, headersObj);
  const idempotencyKey = await computeIdempotencyKey(inboundMessageId, from, subject, text);

  const parsed = parseInboundAddress(to);
  if (!parsed) {
    await supabase.from("external_reservation_logs").insert({
      source: "unknown", raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      status: "failed", error: "address_not_recognized",
    });
    return new Response(JSON.stringify({ ok: false, reason: "address_not_recognized" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // owner特定
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, salon_name, line_channel_access_token")
    .eq("inbound_key", parsed.inboundKey)
    .maybeSingle();

  if (!profile) {
    await supabase.from("external_reservation_logs").insert({
      source: parsed.source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      status: "failed", error: "owner_not_found",
    });
    return new Response(JSON.stringify({ ok: false, reason: "owner_not_found" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ownerId = profile.id as string;
  const source = inferSourceFromContent(subject, text, parsed.source);

  // === 冪等チェック (重複Webhookを早期遮断) ===
  {
    const { data: dup } = await supabase
      .from("external_reservation_logs")
      .select("id, status, created_booking_id")
      .eq("owner_id", ownerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (dup) {
      console.log("inbound dedup hit:", { idempotencyKey, dupId: dup.id });
      return new Response(JSON.stringify({ ok: true, deduped: true, log_id: dup.id, booking_id: dup.created_booking_id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // プライマリ店舗を取得（無ければ最古の店舗）
  let locationId: string | null = null;
  {
    const { data: loc } = await supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", ownerId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    locationId = loc?.id ?? null;
  }

  // AI解析
  let extracted: any;
  try {
    extracted = await aiExtractReservation(source, subject, text);
  } catch (e: any) {
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      status: "failed", error: `ai_error: ${e.message}`,
    });
    return new Response(JSON.stringify({ ok: false, reason: "ai_failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // キャンセルメール → 既存予約をキャンセル状態に
  // CRITICAL: is_reservation フラグに依存しない（AIが false で返すケースが頻発するため）
  if (extracted.event_type === "cancelled") {
    const phoneC = normalizePhone(extracted.customer_phone);
    const nameC = (extracted.customer_name || "").toString().trim();

    // 候補予約の検索：日付＋時刻＋（電話 or 名前）でマッチ
    let query = supabase
      .from("bookings")
      .select("id, status, customer_id, customers(full_name, phone)")
      .eq("owner_id", ownerId)
      .eq("external_source", source)
      .in("status", ["pending", "confirmed"]);

    if (extracted.booking_date) query = query.eq("booking_date", extracted.booking_date);
    const { data: candidates } = await query.limit(20);

    let target: any = null;
    if (candidates && candidates.length > 0) {
      // 時刻一致を優先
      const timeMatch = extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time)
        ? extracted.booking_time + ":00" : null;
      target = candidates.find((c: any) => {
        const cp = (c.customers?.phone || "").trim();
        const cn = (c.customers?.full_name || "").trim();
        const phoneMatch = phoneC && cp && phoneC === cp;
        const nameMatch = nameC && cn && (nameC === cn || nameC.includes(cn) || cn.includes(nameC));
        return phoneMatch || nameMatch;
      }) || (candidates.length === 1 ? candidates[0] : null);
    }

    if (target) {
      // 進行中の同期 (pending/syncing) は自動上書きしない → 人間判断へ
      const { data: bk } = await supabase
        .from("bookings")
        .select("sync_status, external_reservation_id")
        .eq("id", target.id)
        .maybeSingle();
      const inFlight = bk && (bk.sync_status === "pending" || bk.sync_status === "syncing");
      // external_reservation_id 一致を確認（あれば優先一致条件）
      const extId = (extracted.external_reservation_id || "").toString().trim();
      const idMatches = extId && bk?.external_reservation_id && extId === bk.external_reservation_id;
      const safeAuto = !inFlight && (idMatches || !extId); // ID一致 or 元々ID無し → 自動許可

      if (safeAuto) {
        await supabase.from("bookings").update({
          status: "cancelled",
          cancelled_source: source,
          cancelled_at: new Date().toISOString(),
          sync_status: "success",
        }).eq("id", target.id);
        await supabase.from("external_reservation_logs").insert({
          owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
          parsed_data: extracted, status: "cancelled_booking", matched_customer_id: target.customer_id, created_booking_id: target.id,
        });
        try {
          await supabase.functions.invoke("notify-owner-booking", {
            body: { bookingId: target.id, eventType: "cancelled" },
          });
        } catch {}
        return new Response(JSON.stringify({ ok: true, cancelled: true, booking_id: target.id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // pending/syncing 中、または ID 不一致 → needs_review
      await supabase.from("bookings").update({ sync_status: "needs_review" }).eq("id", target.id);
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: extracted, status: "needs_review", matched_customer_id: target.customer_id, created_booking_id: target.id,
        error: inFlight ? "cancel_during_sync_inflight" : "cancel_external_id_mismatch",
      });
      return new Response(JSON.stringify({ ok: true, needs_review: true, booking_id: target.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // マッチなし → needs_review（誤キャンセルを避けるため自動更新しない）
    // CRITICAL: オーナーに即時通知（放置すると無断キャンセルとして扱われクレーム化）
    const { data: logRow } = await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: extracted, status: "needs_review", error: "cancel_target_not_found",
    }).select("id").single();
    try {
      await supabase.functions.invoke("notify-owner-booking", {
        body: {
          eventType: "cancel_needs_review",
          ownerId,
          payload: {
            customer_name: extracted.customer_name,
            booking_date: extracted.booking_date,
            booking_time: extracted.booking_time,
            external_reservation_id: extracted.external_reservation_id,
            log_id: logRow?.id,
          },
        },
      });
    } catch (e) { console.error("cancel needs_review notify failed:", e); }
    return new Response(JSON.stringify({ ok: true, needs_review: true, reason: "cancel_target_not_found" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // === 変更通知 (event_type='changed') ===
  // external_reservation_id 一致が取れた場合のみ自動更新。それ以外は needs_review。
  if (extracted.event_type === "changed") {
    const extId = (extracted.external_reservation_id || "").toString().trim();
    let target: any = null;
    if (extId) {
      const { data } = await supabase.from("bookings")
        .select("id, customer_id, sync_status, external_reservation_id")
        .eq("owner_id", ownerId).eq("external_source", source).eq("external_reservation_id", extId)
        .maybeSingle();
      target = data;
    }
    const inFlight = target && (target.sync_status === "pending" || target.sync_status === "syncing");
    if (target && !inFlight && extracted.extraction_confidence !== "low") {
      const updates: any = {};
      if (extracted.booking_date) updates.booking_date = extracted.booking_date;
      if (extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time)) updates.booking_time = extracted.booking_time + ":00";
      if (extracted.menu) updates.menu = String(extracted.menu).slice(0, 200);
      if (extracted.notes) updates.notes = String(extracted.notes).slice(0, 500);
      updates.sync_status = "success";
      await supabase.from("bookings").update(updates).eq("id", target.id);
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: extracted, status: "updated", matched_customer_id: target.customer_id, created_booking_id: target.id,
      });
      try { await supabase.functions.invoke("notify-owner-booking", { body: { bookingId: target.id, eventType: "changed" } }); } catch {}
      return new Response(JSON.stringify({ ok: true, updated: true, booking_id: target.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // 自動更新できない → needs_review
    if (target) {
      await supabase.from("bookings").update({ sync_status: "needs_review" }).eq("id", target.id);
    }
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: extracted, status: "needs_review",
      created_booking_id: target?.id ?? null,
      error: !extId ? "changed_no_external_id" : !target ? "changed_target_not_found" : inFlight ? "changed_during_sync_inflight" : "changed_low_confidence",
    });
    return new Response(JSON.stringify({ ok: true, needs_review: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 予約以外（問い合わせ等）はログだけ残す
  if (!extracted.is_reservation || extracted.event_type !== "created") {
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: extracted, status: "skipped", error: `event=${extracted.event_type}`,
    });
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 抽出結果の検証: AIがハルシネーションしていないか確認
  // 顧客名が本文に含まれていなければ無効化（信頼度low扱い）
  let confidence: "high" | "low" = extracted.extraction_confidence === "low" ? "low" : "high";
  if (extracted.customer_name) {
    const nm = String(extracted.customer_name).replace(/\s+/g, "");
    const bodyClean = text.replace(/\s+/g, "");
    // 名前の一部（最初の2文字以上）が本文に含まれているか
    const nameKey = nm.slice(0, Math.min(2, nm.length));
    if (nameKey && !bodyClean.includes(nameKey)) {
      console.warn("AI hallucination detected: customer_name not in body:", extracted.customer_name);
      extracted.customer_name = null;
      confidence = "low";
    }
  }
  // 文字化け検知（ISO-2022-JPエスケープが残っている / 制御文字が異常に多い）
  const garbleScore = (text.match(/\x1B\$B/g) || []).length + (text.match(/\uFFFD/g) || []).length;
  if (garbleScore > 5) {
    confidence = "low";
  }

  const phone = normalizePhone(extracted.customer_phone);
  // 信頼度lowで氏名なしなら、自動登録せず needs_review として人手確認に
  if (confidence === "low" && !extracted.customer_name && !phone) {
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: { ...extracted, _confidence: confidence, _garble_score: garbleScore },
      status: "needs_review", error: "low_confidence_no_identity",
    });
    return new Response(JSON.stringify({ ok: true, needs_review: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // === source='salonboard' は確定予約として登録するための厳格な前提条件チェック ===
  // 必須: customer_name / booking_date / booking_time / (menu or notes) / confidence!=low
  // 不足する場合は bookings を作成せず needs_review として SyncReview に出す
  if (source === "salonboard") {
    const missing: string[] = [];
    if (!extracted.customer_name) missing.push("customer_name");
    if (!extracted.booking_date) missing.push("booking_date");
    if (!extracted.booking_time || !/^\d{2}:\d{2}$/.test(extracted.booking_time)) missing.push("booking_time");
    if (!extracted.menu && !extracted.notes) missing.push("menu_or_notes");
    if (confidence === "low") missing.push("low_confidence");
    if (missing.length > 0) {
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: { ...extracted, _confidence: confidence, _garble_score: garbleScore, _missing: missing },
        status: "needs_review", error: `salonboard_created_missing: ${missing.join(",")}`,
      });
      return new Response(JSON.stringify({ ok: true, needs_review: true, missing }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const fullName = (extracted.customer_name || "お客様").toString().slice(0, 100);

  // 既存顧客マッチング（電話番号優先 → 氏名）。ただし氏名「お客様」では引かない
  let customerId: string | null = null;
  if (phone) {
    const { data: byPhone } = await supabase
      .from("customers")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("phone", phone)
      .maybeSingle();
    if (byPhone) customerId = byPhone.id;
  }
  if (!customerId && extracted.customer_name && fullName !== "お客様") {
    const { data: byName } = await supabase
      .from("customers")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("full_name", fullName)
      .limit(1)
      .maybeSingle();
    if (byName) customerId = byName.id;
  }

  // 新規顧客作成
  if (!customerId) {
    const { data: newCust, error: custErr } = await supabase
      .from("customers")
      .insert({
        owner_id: ownerId,
        location_id: locationId,
        full_name: fullName,
        phone: phone,
        email: extracted.customer_email || null,
        notes: `[${source}より自動取込]`,
        imported_from: source,
      })
      .select("id")
      .single();
    if (custErr) {
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: extracted, status: "failed", error: `customer_insert: ${custErr.message}`,
      });
      return new Response(JSON.stringify({ ok: false, reason: "customer_insert_failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    customerId = newCust.id;
  }

  // 重複チェック → 予約作成（賢いロジック）
  const externalId = extracted.external_reservation_id || `${source}-${extracted.booking_date}-${extracted.booking_time}-${phone || fullName}`;

  const { data: existing } = await supabase
    .from("bookings")
    .select("id, customer_id, customers(full_name, phone)")
    .eq("owner_id", ownerId)
    .eq("external_source", source)
    .eq("external_reservation_id", externalId)
    .maybeSingle() as { data: any };

  if (existing) {
    const existingName = (existing.customers?.full_name || "").trim();
    const existingPhone = (existing.customers?.phone || "").trim();
    const newName = fullName.trim();
    const newPhone = (phone || "").trim();

    // 既存予約が「お客様」（誤登録）または名前一致 → 更新
    const isExistingPlaceholder = !existingName || existingName === "お客様";
    const isSamePerson =
      (newPhone && existingPhone && newPhone === existingPhone) ||
      (newName && existingName && (newName === existingName || newName.includes(existingName) || existingName.includes(newName)));

    if (isExistingPlaceholder || isSamePerson) {
      // 既存予約を新しい正確なデータで更新
      const updates: any = {
        booking_date: extracted.booking_date,
        booking_time: extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time) ? extracted.booking_time + ":00" : undefined,
        menu: (extracted.menu || undefined),
        revenue: extracted.revenue || undefined,
        notes: extracted.notes ? String(extracted.notes).slice(0, 500) : undefined,
      };
      // 顧客差し替え（既存がプレースホルダーで、新規が確実な顧客なら）
      if (isExistingPlaceholder && customerId && customerId !== existing.customer_id && extracted.customer_name) {
        updates.customer_id = customerId;
      }
      // undefinedを除外
      Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

      if (Object.keys(updates).length > 0) {
        await supabase.from("bookings").update(updates).eq("id", existing.id);
      }
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: extracted, status: "updated", matched_customer_id: customerId, created_booking_id: existing.id,
      });
      return new Response(JSON.stringify({ ok: true, updated: true, booking_id: existing.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 別人と判定 → サフィックスを付けて新規作成（needs_review）
    console.warn(`Different person for same external_id ${externalId}: existing="${existingName}" new="${newName}"`);
    // 以下、新規作成フローへ続く（externalIdを変える）
    const altExternalId = `${externalId}-${Date.now().toString(36)}`;
    const { data: booking2, error: bookErr2 } = await supabase
      .from("bookings")
      .insert({
        owner_id: ownerId,
        location_id: locationId,
        customer_id: customerId,
        booking_date: extracted.booking_date,
        booking_time: extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time) ? extracted.booking_time + ":00" : "10:00:00",
        menu: (extracted.menu || "メニュー未指定").toString().slice(0, 200),
        notes: extracted.notes ? String(extracted.notes).slice(0, 500) : null,
        status: "pending",
        revenue: extracted.revenue || 0,
        external_source: source,
        external_reservation_id: altExternalId,
      })
      .select("id")
      .single();
    if (bookErr2) {
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: extracted, status: "failed", matched_customer_id: customerId,
        error: `booking_insert(conflict): ${bookErr2.message}`,
      });
      return new Response(JSON.stringify({ ok: false, reason: "booking_insert_failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: extracted, status: "needs_review", matched_customer_id: customerId,
      created_booking_id: booking2.id, error: `same_external_id_different_person: existing=${existingName}`,
    });
    return new Response(JSON.stringify({ ok: true, conflict_resolved: true, booking_id: booking2.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 時刻フォーマット補正
  const bookingTime = extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time)
    ? extracted.booking_time + ":00"
    : "10:00:00";

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      owner_id: ownerId,
      location_id: locationId,
      customer_id: customerId,
      booking_date: extracted.booking_date,
      booking_time: bookingTime,
      menu: (extracted.menu || "メニュー未指定").toString().slice(0, 200),
      notes: extracted.notes ? String(extracted.notes).slice(0, 500) : null,
      status: "pending",
      revenue: extracted.revenue || 0,
      external_source: source,
      external_reservation_id: externalId,
    })
    .select("id")
    .single();

  if (bookErr) {
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: extracted, status: "failed", matched_customer_id: customerId,
      error: `booking_insert: ${bookErr.message}`,
    });
    return new Response(JSON.stringify({ ok: false, reason: "booking_insert_failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ログ記録
  await supabase.from("external_reservation_logs").insert({
    owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
    parsed_data: extracted, status: "created",
    matched_customer_id: customerId, created_booking_id: booking.id,
  });

  // オーナー通知（メール）
  try {
    await supabase.functions.invoke("notify-owner-booking", {
      body: { bookingId: booking.id, eventType: "created" },
    });
  } catch (e) {
    console.error("owner notify error (non-fatal):", e);
  }

  return new Response(JSON.stringify({ ok: true, booking_id: booking.id, customer_id: customerId }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
