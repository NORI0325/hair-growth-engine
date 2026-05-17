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

type DecodeMeta = {
  detected_charset: string | null;
  transfer_encoding: string | null;
  decode_status: string;
  content_type?: string | null;
};

const emptyDecodeMeta = (): DecodeMeta => ({
  detected_charset: null,
  transfer_encoding: null,
  decode_status: "not_needed",
  content_type: null,
});

function normalizeHeaders(headers: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) out[String(k).toLowerCase()] = String(v ?? "");
  return out;
}

function normalizeCharset(charset: string | null | undefined): string | null {
  if (!charset) return null;
  const cs = charset.toLowerCase().trim().replace(/^['"]|['"]$/g, "").replace(/[_\s]/g, "-");
  const compact = cs.replace(/-/g, "");
  if (["iso2022jp", "jis"].includes(compact)) return "iso-2022-jp";
  if (["shiftjis", "sjis", "windows31j", "cp932", "mskanji"].includes(compact)) return "shift_jis";
  if (["eucjp"].includes(compact)) return "euc-jp";
  if (["utf8", "unicode11utf8"].includes(compact)) return "utf-8";
  return cs;
}

function extractCharset(contentType: string | null | undefined): string | null {
  const m = String(contentType || "").match(/charset\s*=\s*["']?([^"';\s]+)/i);
  return normalizeCharset(m?.[1]);
}

const hasReadableJapanese = (s: string) => /[ぁ-んァ-ヶ一-龠々〆ヵヶ]/.test(s);
const hasIso2022JpEscape = (s: string) => /\x1b\$B|\x1b\(B/i.test(s);
const hasStrippedIso2022JpMarkers = (s: string) => /(^|[^\x1b])\$B[!-~]{3,}/.test(s) && /(^|[^\x1b])\(B/.test(s);
const looksQuotedPrintable = (s: string) => /=\r?\n/.test(s) || ((s.match(/=[0-9A-F]{2}/gi) || []).length >= 3);

function repairStrippedIso2022JpEscapes(input: string): string {
  return input
    .replace(/(^|[^\x1b])\$B/g, (_m, p1) => `${p1}\x1B$B`)
    .replace(/(^|[^\x1b])\(B/g, (_m, p1) => `${p1}\x1B(B`);
}

function binaryStringToBytes(input: string): Uint8Array {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
  return bytes;
}

function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
}

function decodeQuotedPrintableToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function decodeBase64ToBytes(input: string): Uint8Array | null {
  const cleaned = input.replace(/\s+/g, "");
  if (!cleaned || cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  try {
    const bin = atob(cleaned);
    return binaryStringToBytes(bin);
  } catch {
    return null;
  }
}

function decodeMimeWords(input: string): string {
  return input.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_m, rawCharset, enc, value) => {
    const charset = normalizeCharset(rawCharset) || "utf-8";
    try {
      const bytes = enc.toLowerCase() === "b"
        ? decodeBase64ToBytes(value)
        : decodeQuotedPrintableToBytes(value.replace(/_/g, " "));
      return bytes ? decodeBytes(bytes, charset) : _m;
    } catch {
      return _m;
    }
  });
}

// 日本語メールの共通前処理: MIME encoded-word / Content-Transfer-Encoding / charset / ISO-2022-JP化けをUTF-8へ正規化
function decodeEmailText(input: string, headers: Record<string, string> = {}, fallbackCharset?: string | null): { text: string; meta: DecodeMeta } {
  const meta = emptyDecodeMeta();
  if (!input) return { text: input, meta };

  const contentType = headers["content-type"] || headers["content_type"] || "";
  const charset = extractCharset(contentType) || normalizeCharset(fallbackCharset);
  const transferEncoding = normalizeCharset(headers["content-transfer-encoding"] || headers["content_transfer_encoding"] || "");
  meta.detected_charset = charset;
  meta.transfer_encoding = headers["content-transfer-encoding"] || headers["content_transfer_encoding"] || null;
  meta.content_type = contentType || null;

  let text = decodeMimeWords(input);
  const alreadyReadable = hasReadableJapanese(text) && !hasIso2022JpEscape(text) && !hasStrippedIso2022JpMarkers(text) && !looksQuotedPrintable(text);
  if (alreadyReadable) {
    meta.decode_status = "already_utf8";
    return { text, meta };
  }

  try {
    if (transferEncoding === "base64") {
      const bytes = decodeBase64ToBytes(text);
      if (bytes) {
        text = decodeBytes(bytes, charset || "utf-8");
        meta.decode_status = `decoded_base64_${charset || "utf-8"}`;
        return { text, meta };
      }
    }

    if (transferEncoding === "quoted-printable" || looksQuotedPrintable(text)) {
      text = decodeBytes(decodeQuotedPrintableToBytes(text), charset || "utf-8");
      meta.decode_status = `decoded_quoted_printable_${charset || "utf-8"}`;
    } else if (hasIso2022JpEscape(text) || hasStrippedIso2022JpMarkers(text)) {
      const repaired = hasStrippedIso2022JpMarkers(text) ? repairStrippedIso2022JpEscapes(text) : text;
      text = decodeBytes(binaryStringToBytes(repaired), "iso-2022-jp");
      meta.detected_charset = meta.detected_charset || "iso-2022-jp";
      meta.decode_status = hasStrippedIso2022JpMarkers(input) ? "decoded_iso2022jp_repaired_esc" : "decoded_iso2022jp";
    } else if (charset && charset !== "utf-8") {
      text = decodeBytes(binaryStringToBytes(text), charset);
      meta.decode_status = `decoded_${charset}`;
    }
  } catch (e) {
    console.warn("email decode failed:", e);
    meta.decode_status = `failed_${charset || "unknown"}`;
  }

  return { text, meta };
}

function withDecodeMeta(parsedData: any, meta: DecodeMeta, rawTextUtf8: string): any {
  const base = parsedData && typeof parsedData === "object" && !Array.isArray(parsedData) ? parsedData : { value: parsedData };
  return {
    ...base,
    _email_decode: {
      detected_charset: meta.detected_charset,
      transfer_encoding: meta.transfer_encoding,
      decode_status: meta.decode_status,
      raw_text_utf8: rawTextUtf8.slice(0, 8000),
    },
  };
}

// Resend Inbound API から本文を取得（webhookにはメタデータしか含まれないため）
async function fetchInboundEmailBody(emailId: string): Promise<{ text: string; html: string; subject: string; from: string; to: string[]; decodeMeta: DecodeMeta } | null> {
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
    const headers = normalizeHeaders(data.headers || {});
    const fallbackCharset = extractCharset(headers["content-type"] || "");

    let text = data.text || "";
    let html = data.html || "";
    let subject = data.subject || "";

    const textDecoded = decodeEmailText(text, headers, fallbackCharset);
    const htmlDecoded = decodeEmailText(html, headers, fallbackCharset);
    const subjectDecoded = decodeEmailText(subject, headers, fallbackCharset);
    text = textDecoded.text;
    html = htmlDecoded.text;
    subject = subjectDecoded.text;

    return {
      text,
      html,
      subject,
      from: typeof data.from === "string" ? data.from : (data.from?.email || ""),
      to: Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []),
      decodeMeta: textDecoded.meta.decode_status !== "not_needed" ? textDecoded.meta : subjectDecoded.meta,
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

function normalizeExternalReservationId(value: unknown): string | null {
  const id = String(value || "").trim().toUpperCase();
  return /^[A-Z]{1,4}\d{6,12}$/.test(id) ? id : null;
}

function isPlaceholderReservationName(name: unknown, extId?: string | null): boolean {
  const normalized = String(name || "").replace(/\s+/g, "").trim();
  if (!normalized) return true;
  if (normalized === "お客様") return true;
  return !!extId && normalized === `予約${extId}`;
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
  const dataHeaders = normalizeHeaders(data.headers || {});
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
  let decodeMeta = emptyDecodeMeta();

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
      decodeMeta = fetched.decodeMeta;
    }
  }

  // 文字コード判定 & デコード（ISO-2022-JP / Shift_JIS / MIME encoded-word など）
  const textDecoded = decodeEmailText(text, dataHeaders, decodeMeta.detected_charset);
  const subjectDecoded = decodeEmailText(subject, dataHeaders, textDecoded.meta.detected_charset || decodeMeta.detected_charset);
  text = textDecoded.text;
  subject = subjectDecoded.text;
  if (textDecoded.meta.decode_status !== "not_needed" && textDecoded.meta.decode_status !== "already_utf8") {
    decodeMeta = textDecoded.meta;
  } else if (decodeMeta.decode_status === "not_needed") {
    decodeMeta = textDecoded.meta;
  }

  // === 冪等キー計算 (重複Webhook防止) ===
  const headersObj: Record<string, string> = dataHeaders;
  const inboundMessageId = extractInboundMessageId(data, headersObj);
  const idempotencyKey = await computeIdempotencyKey(inboundMessageId, from, subject, text);

  const parsed = parseInboundAddress(to);
  if (!parsed) {
    await supabase.from("external_reservation_logs").insert({
      source: "unknown", raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      status: "failed", error: "address_not_recognized", parsed_data: withDecodeMeta({ kind: "decode_info" }, decodeMeta, text),
    });
    return new Response(JSON.stringify({ ok: false, reason: "address_not_recognized" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // owner特定
  const inboundKeyCandidates = Array.from(new Set([
    parsed.inboundKey,
    parsed.source === "salonboard" && !parsed.inboundKey.startsWith("sb-") ? `sb-${parsed.inboundKey}` : null,
    parsed.inboundKey.startsWith("sb-") ? parsed.inboundKey.replace(/^sb-/, "") : null,
  ].filter(Boolean))) as string[];

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, salon_name, line_channel_access_token")
    .in("inbound_key", inboundKeyCandidates)
    .limit(1)
    .maybeSingle();

  if (!profile) {
    await supabase.from("external_reservation_logs").insert({
      source: parsed.source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      status: "failed", error: `owner_not_found: inbound_key=${parsed.inboundKey}`, parsed_data: withDecodeMeta({ inbound_key_candidates: inboundKeyCandidates }, decodeMeta, text),
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

  // === 認証メール / Gmail転送確認メールの検出（予約以外メールも保存）===
  const verifyHaystack = `${subject}\n${text}`;
  const isGmailForwardConfirm = /forwarding-noreply@google\.com/i.test(from) || /Gmail の転送の確認/.test(subject);
  const verifyKeywords = /(認証コード|確認コード|ワンタイムパスワード|verification code|confirm your email|本人確認|二段階認証|2段階認証|認証用|ログイン認証|サロンボード.*(認証|確認|有効)|salon\s?board[\s\S]{0,200}(verif|confirm|認証|確認|有効)|メールアドレス[\s\S]{0,120}(確認|有効))/i;
  const isVerificationMail = isGmailForwardConfirm || verifyKeywords.test(verifyHaystack);
  if (isVerificationMail) {
    const urlMatch = text.match(/https?:\/\/\S+/g) || [];
    const codeMatch = text.match(/(?:認証|確認|verification|verify)[^\d]{0,20}(\d{4,8})/i)
      || text.match(/\b(\d{6})\b/);
    const vstatus = isGmailForwardConfirm ? "other" : "verification";
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject,
      raw_text: text.slice(0, 8000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      status: vstatus, error: isGmailForwardConfirm ? "gmail_forward_confirm" : "verification_mail",
      parsed_data: withDecodeMeta({
        kind: vstatus,
        verification_urls: urlMatch.slice(0, 5),
        verification_code: codeMatch ? codeMatch[1] : null,
      }, decodeMeta, text),
    });
    return new Response(JSON.stringify({ ok: true, kind: vstatus }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
    const extId = normalizeExternalReservationId(extracted.external_reservation_id);

    // 第1優先: external_reservation_id 完全一致。source表記差分（salonboard/salonboard_email）や氏名文字化けに依存しない。
    let candidates: any[] = [];
    let searchedByExternalId = false;
    let fallbackSearchUsed = false;
    if (extId) {
      const { data } = await supabase
        .from("bookings")
        .select("id, status, customer_id, sync_status, external_reservation_id, customers(full_name, phone)")
        .eq("owner_id", ownerId)
        .eq("external_reservation_id", extId)
        .in("status", ["pending", "confirmed"])
        .limit(20);
      candidates = data || [];
      searchedByExternalId = true;
    }

    // 第2以降: IDが無い/一致しない場合のみ、従来どおり日付＋氏名/電話で候補化
    if (candidates.length === 0) {
      fallbackSearchUsed = true;
      let query = supabase
        .from("bookings")
        .select("id, status, customer_id, sync_status, external_reservation_id, customers(full_name, phone)")
        .eq("owner_id", ownerId)
        .in("status", ["pending", "confirmed"]);

      if (extracted.booking_date) query = query.eq("booking_date", extracted.booking_date);
      const { data } = await query.limit(20);
      candidates = data || [];
    }

    let target: any = null;
    let externalIdMatchCount = 0;
    const usingFallbackCandidates = fallbackSearchUsed || !searchedByExternalId;
    if (candidates && candidates.length > 0) {
      if (extId) {
        const exactIdMatches = candidates.filter((c: any) => c.external_reservation_id === extId);
        externalIdMatchCount = exactIdMatches.length;
        if (exactIdMatches.length === 1) target = exactIdMatches[0];
        else if (exactIdMatches.length > 1) target = null;
      }
      // 時刻一致を優先
      const timeMatch = extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time)
        ? extracted.booking_time + ":00" : null;
      if (!target && (usingFallbackCandidates || !extId)) {
        target = candidates.find((c: any) => {
          const cp = (c.customers?.phone || "").trim();
          const cn = (c.customers?.full_name || "").trim();
          const phoneMatch = phoneC && cp && phoneC === cp;
          const nameMatch = nameC && cn && (nameC === cn || nameC.includes(cn) || cn.includes(nameC));
          return phoneMatch || nameMatch;
        }) || (candidates.length === 1 ? candidates[0] : null);
      }
    }

    if (target) {
      // 進行中の同期 (pending/syncing) は自動上書きしない → 人間判断へ
      const { data: bk } = await supabase
        .from("bookings")
        .select("sync_status, external_reservation_id")
        .eq("id", target.id)
        .maybeSingle();
      const inFlight = bk && (bk.sync_status === "pending" || bk.sync_status === "syncing");
      // external_reservation_id 一致を確認（あれば最優先一致条件）
      const idMatches = extId && bk?.external_reservation_id && extId === bk.external_reservation_id;
      const safeAuto = !inFlight && (idMatches || !extId); // ID一致 or 元々ID無し → 自動許可

      if (safeAuto) {
        const cancelSource = source === "salonboard" ? "salonboard_email" : source;
        let nameCompletionNote: string | null = null;
        let nameCompletionConflict = false;

        if (nameC && target.customer_id && isPlaceholderReservationName(target.customers?.full_name, extId)) {
          const { data: sameNameCustomer } = await supabase
            .from("customers")
            .select("id")
            .eq("owner_id", ownerId)
            .eq("full_name", nameC)
            .limit(1)
            .maybeSingle();
          if (!sameNameCustomer || sameNameCustomer.id === target.customer_id) {
            nameCompletionNote = "キャンセルメールから氏名補完";
            await supabase.from("customers").update({
              full_name: nameC.slice(0, 100),
              notes: `[${nameCompletionNote}] ${target.customers?.full_name ?? ""} → ${nameC}`,
            }).eq("id", target.customer_id);
          } else {
            nameCompletionConflict = true;
            nameCompletionNote = `氏名補完候補が既存顧客と衝突: ${nameC}`;
          }
        }

        await supabase.from("bookings").update({
          status: "cancelled",
          cancelled_source: cancelSource,
          cancelled_at: new Date().toISOString(),
          sync_status: nameCompletionConflict ? "needs_review" : "success",
          needs_manual_review: nameCompletionConflict,
        }).eq("id", target.id);
        await supabase.from("external_reservation_logs").insert({
          owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
          parsed_data: withDecodeMeta({ ...extracted, _match_strategy: idMatches ? "external_reservation_id" : "fallback", _name_completion_note: nameCompletionNote }, decodeMeta, text),
          status: nameCompletionConflict ? "needs_review" : "cancelled_booking", matched_customer_id: target.customer_id, created_booking_id: target.id,
          error: nameCompletionConflict ? "cancelled_by_external_id_name_completion_conflict" : null,
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
        parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "needs_review", matched_customer_id: target.customer_id, created_booking_id: target.id,
        error: inFlight ? "cancel_during_sync_inflight" : "cancel_external_id_mismatch",
      });
      return new Response(JSON.stringify({ ok: true, needs_review: true, booking_id: target.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // マッチなし/複数一致 → needs_review（誤キャンセルを避けるため自動更新しない）
    // CRITICAL: オーナーに即時通知（放置すると無断キャンセルとして扱われクレーム化）
    const cancelTargetError = externalIdMatchCount > 1 ? "cancel_external_id_multiple_matches" : "cancel_target_not_found";
    const { data: logRow } = await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: withDecodeMeta({ ...extracted, _match_strategy: extId ? "external_reservation_id" : "fallback", _external_id_match_count: externalIdMatchCount }, decodeMeta, text),
      status: "needs_review", error: cancelTargetError,
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
        parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "updated", matched_customer_id: target.customer_id, created_booking_id: target.id,
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
      parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "needs_review",
      created_booking_id: target?.id ?? null,
      error: !extId ? "changed_no_external_id" : !target ? "changed_target_not_found" : inFlight ? "changed_during_sync_inflight" : "changed_low_confidence",
    });
    return new Response(JSON.stringify({ ok: true, needs_review: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // === ヒューリスティック・オーバーライド ===
  // 文字化けでAIが is_reservation=false / event_type=other を返しても、
  // 件名や本文に明確な予約シグナルがある場合は created 扱いにして needs_review へ流す。
  // （予約通知メールが何も表示されずに消えるのを防ぐ）
  if (!extracted.is_reservation || extracted.event_type !== "created") {
    const haystack = `${subject}\n${text.slice(0, 2000)}`;
    const reservationCue =
      /予約連絡|予約のお知らせ|予約確定|新規ご予約|ご予約が入りました|ご予約のお知らせ|予約番号|来店予定|RESERVATION/i.test(haystack);
    const cancelCue = /キャンセル|取消|予約解除/.test(haystack);
    const changeCue = /変更|日時変更|内容変更/.test(haystack);
    const hasExtId = !!(extracted.external_reservation_id && String(extracted.external_reservation_id).trim());
    const hasDate = !!extracted.booking_date;
    const hasTime = !!(extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time));

    if (reservationCue && !cancelCue && !changeCue && (hasExtId || (hasDate && hasTime))) {
      console.warn("event_type override: AI=", extracted.event_type, "→ created (reservation cue + identifiers present)");
      extracted.event_type = "created";
      extracted.is_reservation = true;
      extracted._event_type_overridden = true;
    } else {
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: withDecodeMeta(extracted, decodeMeta, text),
        // 予約シグナルがあるのに識別子が無いケースは needs_review、純粋な雑メールは skipped
        status: reservationCue ? "needs_review" : "skipped",
        error: reservationCue ? `reservation_cue_but_no_identifiers` : `event=${extracted.event_type}`,
      });
      return new Response(JSON.stringify({ ok: true, skipped: !reservationCue, needs_review: reservationCue }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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

  // 文字化け救済: external_reservation_id + 日時が取れていれば仮名で自動作成を許可
  // （Gmail転送等で本文文字コードが壊れたメール対策）
  const hasExtId = !!extracted.external_reservation_id;
  const hasDateTime = !!extracted.booking_date && !!extracted.booking_time && /^\d{2}:\d{2}$/.test(extracted.booking_time);
  const garbleRescue = confidence === "low" && !extracted.customer_name && !phone && hasExtId && hasDateTime;
  if (garbleRescue) {
    extracted.customer_name = `予約 ${extracted.external_reservation_id}`;
    extracted._garble_rescued = true;
    if (!extracted.menu) extracted.menu = "（文字化けのため未取得）";
    confidence = "high"; // 識別子+日時があるので登録は許可（needs_reviewは別途で残す）
  }

  // 信頼度lowで氏名なしなら、自動登録せず needs_review として人手確認に
  if (confidence === "low" && !extracted.customer_name && !phone) {
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: withDecodeMeta({ ...extracted, _confidence: confidence, _garble_score: garbleScore }, decodeMeta, text),
      status: "needs_review", error: "low_confidence_no_identity",
    });
    return new Response(JSON.stringify({ ok: true, needs_review: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // === source='salonboard' は確定予約として登録するための厳格な前提条件チェック ===
  // 必須: customer_name / booking_date / booking_time / (menu or notes) / confidence!=low
  // ただし garbleRescue で external_reservation_id + 日時が取れている場合は通す
  if (source === "salonboard") {
    const missing: string[] = [];
    if (!extracted.customer_name) missing.push("customer_name");
    if (!extracted.booking_date) missing.push("booking_date");
    if (!extracted.booking_time || !/^\d{2}:\d{2}$/.test(extracted.booking_time)) missing.push("booking_time");
    if (!extracted.menu && !extracted.notes) missing.push("menu_or_notes");
    if (confidence === "low" && !garbleRescue) missing.push("low_confidence");
    if (missing.length > 0) {
      await supabase.from("external_reservation_logs").insert({
        owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
        parsed_data: withDecodeMeta({ ...extracted, _confidence: confidence, _garble_score: garbleScore, _missing: missing }, decodeMeta, text),
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
        parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "failed", error: `customer_insert: ${custErr.message}`,
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
        parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "updated", matched_customer_id: customerId, created_booking_id: existing.id,
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
        parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "failed", matched_customer_id: customerId,
        error: `booking_insert(conflict): ${bookErr2.message}`,
      });
      return new Response(JSON.stringify({ ok: false, reason: "booking_insert_failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "needs_review", matched_customer_id: customerId,
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

  // source='salonboard' は確定予約として登録（ダブルブッキング防止のため枠を必ずブロック）
  // external_reservation_id が無い、もしくはメニュー解決が不完全な場合は枠は確保しつつ needs_review
  const isSalonboard = source === "salonboard";
  const hasExtIdFinal = !!(extracted.external_reservation_id && String(extracted.external_reservation_id).trim());
  const menuResolved = !!extracted.menu;
  const sbIncomplete = isSalonboard && (!hasExtIdFinal || !menuResolved);

  const insertPayload: any = {
    owner_id: ownerId,
    location_id: locationId,
    customer_id: customerId,
    booking_date: extracted.booking_date,
    booking_time: bookingTime,
    menu: (extracted.menu || "メニュー未指定").toString().slice(0, 200),
    notes: extracted.notes ? String(extracted.notes).slice(0, 500) : null,
    revenue: extracted.revenue || 0,
    external_reservation_id: externalId,
  };

  if (isSalonboard) {
    insertPayload.status = "confirmed";
    insertPayload.external_source = "salonboard_email";
    insertPayload.source_channel = "salonboard";
    insertPayload.sync_status = sbIncomplete ? "needs_review" : "success";
    insertPayload.needs_manual_review = sbIncomplete;
    insertPayload.last_synced_at = new Date().toISOString();
  } else {
    insertPayload.status = "pending";
    insertPayload.external_source = source;
  }

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert(insertPayload)
    .select("id")
    .single();

  if (bookErr) {
    await supabase.from("external_reservation_logs").insert({
      owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
      parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: "failed", matched_customer_id: customerId,
      error: `booking_insert: ${bookErr.message}`,
    });
    return new Response(JSON.stringify({ ok: false, reason: "booking_insert_failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ログ記録
  await supabase.from("external_reservation_logs").insert({
    owner_id: ownerId, source, raw_to: to, raw_from: from, raw_subject: subject, raw_text: text.slice(0, 4000), inbound_message_id: inboundMessageId, idempotency_key: idempotencyKey,
    parsed_data: withDecodeMeta(extracted, decodeMeta, text), status: sbIncomplete ? "needs_review" : "created",
    matched_customer_id: customerId, created_booking_id: booking.id,
    error: sbIncomplete ? `salonboard_partial: ${!hasExtIdFinal ? "no_ext_id " : ""}${!menuResolved ? "no_menu" : ""}`.trim() : null,
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
