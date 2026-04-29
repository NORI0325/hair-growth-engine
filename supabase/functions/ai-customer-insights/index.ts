import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 顧客の来店履歴・属性からAIインサイトを生成しキャッシュに保存
// 入力: { customer_id, force?: boolean }
// 出力: { summary, recommendations, risks, next_visit_suggestion, preferred_tone, generated_at }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ownerId = userData.user.id;

    const { customer_id, force = false } = await req.json();
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // キャッシュチェック（強制再生成でなければ24時間以内のものは再利用）
    if (!force) {
      const { data: cached } = await supabase
        .from("customer_ai_insights")
        .select("*")
        .eq("customer_id", customer_id)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (cached) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          return new Response(JSON.stringify({ ...cached, cached: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // 顧客情報取得
    const { data: customer } = await supabase
      .from("customers")
      .select("id, full_name, owner_id, visit_count, last_visit_date, total_spent, birthday, notes, line_user_id")
      .eq("id", customer_id)
      .maybeSingle();

    if (!customer || customer.owner_id !== ownerId) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 直近の予約（最大10件）
    const { data: bookings } = await supabase
      .from("bookings")
      .select("booking_date, booking_time, menu, status, total_price, notes")
      .eq("customer_id", customer_id)
      .order("booking_date", { ascending: false })
      .limit(10);

    // 直近のLINE受信メッセージ（最大5件）
    const { data: inbounds } = await supabase
      .from("line_inbound_messages")
      .select("message_text, intent, urgency, created_at")
      .eq("customer_id", customer_id)
      .order("created_at", { ascending: false })
      .limit(5);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "missing_api_key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const daysSinceLast = customer.last_visit_date
      ? Math.floor((Date.now() - new Date(customer.last_visit_date).getTime()) / 86400000)
      : null;

    const ctx = `
# お客様基本情報
- お名前: ${customer.full_name}様
- 来店回数: ${customer.visit_count ?? 0}回
- 累計支払額: ¥${(customer.total_spent ?? 0).toLocaleString()}
- 最終来店: ${customer.last_visit_date ?? "未来店"}${daysSinceLast !== null ? ` (${daysSinceLast}日前)` : ""}
- お誕生日: ${customer.birthday ?? "未登録"}
- カルテメモ: ${customer.notes || "（なし）"}
- LINE連携: ${customer.line_user_id ? "あり" : "なし"}
- 本日: ${today}

# 直近予約履歴 (新しい順)
${(bookings || []).map(b => `- ${b.booking_date} ${b.booking_time} | ${b.menu} | ${b.status} | ¥${(b.total_price ?? 0).toLocaleString()}${b.notes ? ` | メモ: ${b.notes}` : ""}`).join("\n") || "（履歴なし）"}

# 直近LINE受信
${(inbounds || []).map(i => `- [${i.intent || "?"}/${i.urgency}] ${i.message_text.slice(0, 80)}`).join("\n") || "（受信なし）"}
`;

    const systemPrompt = `あなたは美容サロンの一流カスタマーサクセス担当です。
お客様の履歴を分析し、現場のオーナー・スタイリストが「次の接客で本当に役立つ」インサイトを抽出します。

【出力ルール】
- recommendations: 具体的な次回提案・アップセル・リテンション施策（最大4件、各40字以内）
- risks: 注意事項・離脱リスク・体調/アレルギー懸念（最大3件、各40字以内）。なければ空配列
- next_visit_suggestion: いつ頃のご来店をおすすめすべきか（30字以内）
- preferred_tone: このお客様への最適なコミュニケーショントーン（"polite"|"friendly"|"luxury"|"casual"のどれか）
- summary: 性格・好みの傾向を含む100字以内の人物像

ビジネスを成長させ、お客様が幸せになる提案だけを書いてください。`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: ctx },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_insights",
            description: "顧客インサイトを構造化して返す",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string" },
                recommendations: { type: "array", items: { type: "string" } },
                risks: { type: "array", items: { type: "string" } },
                next_visit_suggestion: { type: "string" },
                preferred_tone: { type: "string", enum: ["polite", "friendly", "luxury", "casual"] },
              },
              required: ["summary", "recommendations", "risks", "next_visit_suggestion", "preferred_tone"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_insights" } },
      }),
    });

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited", message: "AIの利用が混み合っています。少し待って再度お試しください。" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (res.status === 402) {
      return new Response(JSON.stringify({ error: "credits_required", message: "AIクレジットを追加してください。" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!res.ok) {
      const t = await res.text();
      console.error("ai gateway:", res.status, t);
      return new Response(JSON.stringify({ error: "ai_error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = null;
    if (toolCall?.function?.arguments) {
      try { parsed = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
    }
    if (!parsed) {
      return new Response(JSON.stringify({ error: "no_insights" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const record = {
      owner_id: ownerId,
      customer_id,
      summary: parsed.summary,
      recommendations: parsed.recommendations || [],
      risks: parsed.risks || [],
      next_visit_suggestion: parsed.next_visit_suggestion,
      preferred_tone: parsed.preferred_tone,
      generated_at: new Date().toISOString(),
    };
    await supabase.from("customer_ai_insights").upsert(record, { onConflict: "customer_id" });

    return new Response(JSON.stringify({ ...record, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-customer-insights error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
