import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// AI返信案を3つ生成（LINE向け）
// 入力: { customer_id, context?: string, tone?: "polite"|"friendly"|"luxury" }
// 出力: { suggestions: [{ tone, label, body }] }

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

    const { customer_id, context = "", intent = "" } = await req.json();
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 顧客情報を取得（パーソナライズのため）
    const { data: customer } = await supabase
      .from("customers")
      .select("id, full_name, owner_id, visit_count, last_visit_date, total_spent, notes")
      .eq("id", customer_id)
      .maybeSingle();

    if (!customer || customer.owner_id !== ownerId) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 直近予約も参考にする
    const { data: lastBooking } = await supabase
      .from("bookings")
      .select("booking_date, booking_time, menu, status")
      .eq("customer_id", customer_id)
      .order("booking_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: prof } = await supabase
      .from("profiles")
      .select("salon_name")
      .eq("id", ownerId)
      .maybeSingle();

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "missing_api_key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customerCtx = [
      `お客様名: ${customer.full_name}様`,
      customer.visit_count ? `来店回数: ${customer.visit_count}回` : "",
      customer.last_visit_date ? `最終来店: ${customer.last_visit_date}` : "",
      lastBooking ? `直近予約: ${lastBooking.booking_date} ${lastBooking.booking_time} / ${lastBooking.menu} (${lastBooking.status})` : "",
      customer.notes ? `カルテメモ: ${customer.notes}` : "",
    ].filter(Boolean).join("\n");

    const systemPrompt = `あなたは${prof?.salon_name || "美容サロン"}の一流コンシェルジュです。
お客様へのLINE返信を、思いやりと品格を持って書きます。
- LINE向け：150文字以内、絵文字は控えめに上品に
- 必ずお客様のお名前で始める
- 押し付けがましくない
- サロン名は文末に署名しない（システムが付ける）
- 説明文や前置きは禁止、本文のみ出力`;

    const userPrompt = `# お客様情報
${customerCtx}

# オーナーが伝えたい内容・状況
${context || "（特になし。一般的なお礼やご挨拶）"}
${intent ? `# 意図: ${intent}` : ""}

# 指示
上記をもとに、トーンの異なる返信案を3つ作ってください。
- 案1: 丁寧・フォーマル（polite）
- 案2: 温かみ・親しみ（friendly）
- 案3: ラグジュアリー・上質感（luxury）

必ず以下のJSONで返してください（前置き・説明・コードブロック禁止）:
{"suggestions":[{"tone":"polite","label":"丁寧","body":"..."},{"tone":"friendly","label":"親しみ","body":"..."},{"tone":"luxury","label":"上質","body":"..."}]}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_suggestions",
            description: "3つの返信案を返す",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      tone: { type: "string", enum: ["polite", "friendly", "luxury"] },
                      label: { type: "string" },
                      body: { type: "string" },
                    },
                    required: ["tone", "label", "body"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_suggestions" } },
      }),
    });

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited", message: "AIの利用が混み合っています。少し待って再度お試しください。" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (res.status === 402) {
      return new Response(JSON.stringify({ error: "credits_required", message: "AIクレジットを追加してください（Settings > Workspace > Usage）。" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!res.ok) {
      const t = await res.text();
      console.error("ai gateway error:", res.status, t);
      return new Response(JSON.stringify({ error: "ai_error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    let suggestions: any[] = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        suggestions = parsed.suggestions || [];
      } catch (e) {
        console.error("parse error:", e);
      }
    }

    if (!suggestions.length) {
      return new Response(JSON.stringify({ error: "no_suggestions" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-reply-suggestions error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
