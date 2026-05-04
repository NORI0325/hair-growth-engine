// 予約意図検出 + Gemini AI解析モジュール
// LINEメッセージから「予約希望」を抽出し、構造化データに変換する

export interface ReservationParseResult {
  isReservation: boolean;
  confidence: number; // 0-100
  desiredDateCandidates: Array<{
    date?: string; // YYYY-MM-DD
    timeRange?: string; // "afternoon" | "morning" | "evening" | "14:00" など
    note?: string;
  }>;
  desiredMenu?: string;
  desiredMenuItems?: string[];
  desiredStaffName?: string;
  needsClarificationFields: string[]; // ["date","menu","staff"] など
  summary: string; // スタッフ向け1行要約
  reasoning?: string;
}

// 「予約っぽい」キーワードでまず1次フィルタ
const RESERVATION_KEYWORDS = [
  "予約", "よやく", "ヨヤク", "booking", "reservation",
  "空い", "あい", "あき", "空き",
  "取れ", "取りたい", "とりたい",
  "お願いし", "おねがいし",
  "行きたい", "いきたい",
  "来店", "来週", "再来週", "今週", "明日", "あした", "あさって", "明後日",
  "カット", "カラー", "パーマ", "縮毛", "矯正", "トリートメント", "ヘッドスパ",
];

const NON_RESERVATION_HINTS = [
  "ありがとう", "ありがとうございました", "よかった", "ですね",
  "了解", "りょうかい", "わかりました", "おつかれ",
  "キャンセル", "けっこう", "結構です",
];

export function quickReservationIntent(text: string): { matched: boolean; score: number } {
  if (!text) return { matched: false, score: 0 };
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of RESERVATION_KEYWORDS) {
    if (text.includes(kw) || lower.includes(kw)) score += 10;
  }
  for (const kw of NON_RESERVATION_HINTS) {
    if (text.includes(kw)) score -= 8;
  }
  // 強シグナル
  if (/予約.{0,4}(したい|お願|取り|取れ|入れ)/.test(text)) score += 30;
  if (/(空い|あい|あき).{0,4}(時間|日|枠|曜)/.test(text)) score += 20;
  if (/\d{1,2}\/\d{1,2}/.test(text)) score += 10;
  if (/\d{1,2}時/.test(text)) score += 10;
  return { matched: score >= 15, score };
}

export async function parseReservationWithAI(params: {
  text: string;
  customerName?: string;
  todayJst: string; // YYYY-MM-DD
  pastMenus?: string[];
  pastStaffNames?: string[];
  availableMenus?: string[];
  availableStaffs?: string[];
}): Promise<ReservationParseResult | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("[reservation-intent] LOVABLE_API_KEY missing, skipping AI parse");
    return null;
  }

  const sys = `あなたは美容サロンの予約受付AIです。
お客様からのLINEメッセージを解析し、予約希望を構造化データとして抽出します。
今日(JST)は ${params.todayJst} です。

【抽出項目】
- 希望日候補（複数可）: YYYY-MM-DD形式。「来週土曜」「再来週」「明日」なども計算してください
- 希望時間帯: "morning"(〜12時) / "afternoon"(12-17時) / "evening"(17時〜) / または具体時刻 "14:00"
- メニュー: お客様が言及したメニュー名（自然な日本語のまま）
- スタッフ指名: お客様が言及した名前。「いつもの方」「前回の人」は staff_unspecified_referred として扱う
- 信頼度(0-100): 抽出結果がどれだけ確かか
- 不足フィールド: ["date","time","menu","staff"] のうち明示されていないもの

【ルール】
- 予約意図がない（雑談・お礼・キャンセル等）場合は is_reservation=false
- 曖昧な場合でも、わかる範囲で抽出する
- 信頼度が高い基準: 日時が具体的、メニューが明示、文章に矛盾がない
- 必ず指定の関数で構造化して返答してください`;

  const ctx = [
    params.customerName ? `お客様: ${params.customerName}様` : null,
    params.pastMenus?.length ? `過去メニュー履歴: ${params.pastMenus.slice(0,5).join(", ")}` : null,
    params.pastStaffNames?.length ? `過去担当: ${params.pastStaffNames.slice(0,3).join(", ")}` : null,
    params.availableMenus?.length ? `店舗メニュー一覧: ${params.availableMenus.slice(0,20).join(", ")}` : null,
    params.availableStaffs?.length ? `スタッフ: ${params.availableStaffs.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `${ctx}\n\n受信メッセージ:\n${params.text.slice(0, 1000)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_reservation",
            description: "予約希望を構造化抽出",
            parameters: {
              type: "object",
              properties: {
                is_reservation: { type: "boolean" },
                confidence: { type: "integer", minimum: 0, maximum: 100 },
                desired_date_candidates: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string", description: "YYYY-MM-DD" },
                      time_range: { type: "string" },
                      note: { type: "string" },
                    },
                  },
                },
                desired_menu: { type: "string" },
                desired_menu_items: { type: "array", items: { type: "string" } },
                desired_staff_name: { type: "string" },
                needs_clarification_fields: {
                  type: "array",
                  items: { type: "string", enum: ["date", "time", "menu", "staff"] },
                },
                summary: { type: "string", description: "スタッフ向け1行要約" },
                reasoning: { type: "string" },
              },
              required: ["is_reservation", "confidence", "summary"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_reservation" } },
      }),
    });

    if (!res.ok) {
      console.error("[reservation-intent] AI error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) return null;
    const args = JSON.parse(call.function.arguments);

    return {
      isReservation: !!args.is_reservation,
      confidence: Math.max(0, Math.min(100, Number(args.confidence) || 0)),
      desiredDateCandidates: Array.isArray(args.desired_date_candidates)
        ? args.desired_date_candidates : [],
      desiredMenu: args.desired_menu || undefined,
      desiredMenuItems: Array.isArray(args.desired_menu_items) ? args.desired_menu_items : undefined,
      desiredStaffName: args.desired_staff_name || undefined,
      needsClarificationFields: Array.isArray(args.needs_clarification_fields)
        ? args.needs_clarification_fields : [],
      summary: args.summary || "",
      reasoning: args.reasoning,
    };
  } catch (e) {
    console.error("[reservation-intent] parse exception:", e);
    return null;
  }
}

// 仮受付の自動返信文を組み立てる
export function buildReservationAutoReply(params: {
  customerName: string;
  salonName: string;
  parsed: ReservationParseResult;
  isOutsideHours: boolean;
  openTime?: string;
  closeTime?: string;
}): string {
  const { customerName, salonName, parsed, isOutsideHours, openTime, closeTime } = params;
  const hours = openTime && closeTime ? `${openTime.slice(0,5)}〜${closeTime.slice(0,5)}` : "";

  // 受け取った内容のおさらい
  const lines: string[] = [];
  if (parsed.desiredDateCandidates.length > 0) {
    const dateText = parsed.desiredDateCandidates
      .slice(0, 3)
      .map((c) => {
        const d = c.date || "";
        const tr = c.timeRange ? `（${jpTimeRange(c.timeRange)}）` : "";
        return `${formatJpDate(d)}${tr}`;
      })
      .filter(Boolean).join(" / ");
    if (dateText) lines.push(`📅 希望日時: ${dateText}`);
  }
  if (parsed.desiredMenu) lines.push(`💇 メニュー: ${parsed.desiredMenu}`);
  if (parsed.desiredStaffName) lines.push(`👤 ご指名: ${parsed.desiredStaffName}様`);
  const recap = lines.length > 0 ? `\n\n${lines.join("\n")}` : "";

  const timeNote = isOutsideHours
    ? `現在は営業時間外のため、翌営業時間（${hours}）内に担当者より確定のご連絡をいたします。`
    : `担当者が確認のうえ、確定のご連絡を差し上げます。`;

  return `${customerName}様

ご予約のご希望ありがとうございます🌸
以下の内容で「仮受付」いたしました。${recap}

${timeNote}

※ こちらは仮受付です。お席の確定はお店からの返信をもってとさせていただきます。

— ${salonName}`;
}

function jpTimeRange(tr: string): string {
  const map: Record<string, string> = {
    morning: "午前", afternoon: "午後", evening: "夕方",
  };
  return map[tr] || tr;
}

function formatJpDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [, m, d] = ymd.split("-");
  const date = new Date(`${ymd}T00:00:00+09:00`);
  const w = ["日","月","火","水","木","金","土"][date.getDay()];
  return `${Number(m)}/${Number(d)}(${w})`;
}

// 営業時間外チェック
export function isOutsideBusinessHoursJst(openTime?: string, closeTime?: string): boolean {
  if (!openTime || !closeTime) return false;
  const now = new Date();
  const jstMs = now.getTime() + (9 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000);
  const jst = new Date(jstMs);
  const cur = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const [oh, om] = openTime.split(":").map(Number);
  const [ch, cm] = closeTime.split(":").map(Number);
  return cur < (oh * 60 + om) || cur >= (ch * 60 + cm);
}

export function todayJstIso(): string {
  const now = new Date();
  const jstMs = now.getTime() + (9 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(jstMs).toISOString().slice(0, 10);
}
