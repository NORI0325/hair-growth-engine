import { corsHeaders } from "../_shared/cors.ts";

// Lovable AI Gateway: 文章リライト・トーン調整
// 入力: { text, action, tone?, channel? }
// action: "polish" | "shorten" | "expand" | "emoji" | "tone" | "translate_polite" | "custom"
// tone: "casual" | "polite" | "luxury" | "friendly" | "young" | "mature"
// channel: "email" | "line" (LINEは絵文字多め・短文)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, action = "polish", tone, channel = "email", instruction } = await req.json();

    if (!text || typeof text !== "string" || text.length > 4000) {
      return new Response(JSON.stringify({ error: "invalid_text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "missing_api_key" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let systemPrompt = "あなたは美容サロンの一流コピーライターです。日本語で自然な文章を書きます。返信は本文のみ（説明や前置き禁止）。";
    let userPrompt = "";

    const channelHint = channel === "line"
      ? "LINE向けに、短く（150文字以内）、絵文字を程よく入れて、温かみのある口調で。"
      : "メール向けに、丁寧で読みやすい段落構成で。";

    switch (action) {
      case "polish":
        userPrompt = `次の文章を、より自然で心に響くように整えてください。${channelHint}\n---\n${text}`;
        break;
      case "shorten":
        userPrompt = `次の文章を半分以下に要約してください。重要な要素は残してください。${channelHint}\n---\n${text}`;
        break;
      case "expand":
        userPrompt = `次の文章をより丁寧に、心遣いを感じる内容に膨らませてください。${channelHint}\n---\n${text}`;
        break;
      case "emoji":
        userPrompt = `次の文章に、サロンらしい絵文字を程よく追加してください。文意は変えず。${channelHint}\n---\n${text}`;
        break;
      case "tone":
        userPrompt = `次の文章を「${tone || "polite"}」なトーンに書き換えてください。${channelHint}\n---\n${text}`;
        break;
      case "custom":
        userPrompt = `次の文章を、以下の指示に従って書き換えてください。\n指示: ${instruction || "より良くしてください"}\n${channelHint}\n---\n${text}`;
        break;
      default:
        userPrompt = `次の文章を改善してください。${channelHint}\n---\n${text}`;
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (res.status === 402) {
      return new Response(JSON.stringify({ error: "credits_required" }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: "ai_error", detail: t.slice(0, 300) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const result = data?.choices?.[0]?.message?.content?.trim() || "";

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
