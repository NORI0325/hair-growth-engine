import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

// AIヘルプアシスタント
// 入力: { message, history?: [{role,content}], route?: string, sessionId?: string }
// ロジック: 質問キーワードでヘルプ記事を検索 → 関連記事をシステムプロンプトに埋め込み → Gemini 2.5 Flash で回答

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, history = [], route, sessionId } = await req.json();
    if (!message || typeof message !== "string" || message.length > 2000) {
      return new Response(JSON.stringify({ error: "invalid_message" }), {
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 認証ユーザー
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    // 関連記事を検索（route一致 OR キーワード/タイトル部分一致）
    const queryText = message.toLowerCase();
    const { data: articles } = await supabase
      .from("help_articles")
      .select("slug,category,title,summary,body,related_routes,keywords")
      .eq("published", true);

    const scored = (articles ?? []).map((a) => {
      let score = 0;
      if (route && a.related_routes?.includes(route)) score += 5;
      const text = `${a.title} ${a.summary ?? ""} ${(a.keywords ?? []).join(" ")}`.toLowerCase();
      for (const word of queryText.split(/\s+/).filter((w) => w.length >= 2)) {
        if (text.includes(word)) score += 2;
        if (a.body.toLowerCase().includes(word)) score += 1;
      }
      return { a, score };
    }).sort((x, y) => y.score - x.score).slice(0, 4);

    const context = scored.filter((s) => s.score > 0).map((s) =>
      `### ${s.a.title}\nカテゴリ: ${s.a.category}\n${s.a.body}`
    ).join("\n\n---\n\n");

    const systemPrompt = `あなたは美容サロン向け予約・顧客管理SaaS「Arune Hair」の専属サポート担当です。日本語で、温かく丁寧に、簡潔に答えてください。

【絶対ルール】
- 下記「参考マニュアル」に書かれている内容を最優先で根拠にしてください。
- マニュアルに無い機能を「ある」と言わないでください。不明な場合は「申し訳ございません、その機能については確認できません。右下の『人に聞く』からご質問ください」と案内してください。
- 回答はマークダウン。手順は番号付きリストで。長くなりすぎず、要点を3〜6行で。
- 関連する画面ページがあれば「（左メニューの『○○』から開けます）」と添えてください。
- 技術用語（Supabase等）は使わず、利用者目線の言葉で。

【現在のユーザー画面】 ${route ?? "不明"}

【参考マニュアル】
${context || "（関連記事なし）"}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-6),
      { role: "user", content: message },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited", message: "少し時間を置いてからお試しください。" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (res.status === 402) {
      return new Response(JSON.stringify({ error: "credits_required", message: "AIクレジットが不足しています。" }), {
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
    const reply = data?.choices?.[0]?.message?.content?.trim() || "申し訳ございません、回答を生成できませんでした。";

    // 履歴保存
    if (userId && sessionId) {
      await supabase.from("support_chat_messages").insert([
        { user_id: userId, session_id: sessionId, role: "user", content: message, context_route: route },
        { user_id: userId, session_id: sessionId, role: "assistant", content: reply, context_route: route },
      ]);
    }

    return new Response(
      JSON.stringify({ reply, related: scored.filter((s) => s.score > 0).map((s) => ({ slug: s.a.slug, title: s.a.title })) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
