import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { invokeInternal } from "../_shared/invoke-internal.ts";

// 受信メッセージをAIで分類（バックグラウンドで line-webhook から非同期invoke）
// 入力: { inbound_id }
// 出力: { intent, urgency, summary, suggested_action }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { inbound_id } = await req.json();
    if (!inbound_id) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: inbound } = await supabase
      .from("line_inbound_messages")
      .select("id, owner_id, customer_id, message_text, ai_processed")
      .eq("id", inbound_id)
      .maybeSingle();

    if (!inbound) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (inbound.ai_processed) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 顧客情報（あれば文脈に）
    let customerCtx = "";
    if (inbound.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("full_name, visit_count, last_visit_date")
        .eq("id", inbound.customer_id)
        .maybeSingle();
      if (c) {
        customerCtx = `お客様: ${c.full_name}様 / 来店${c.visit_count ?? 0}回 / 最終来店${c.last_visit_date ?? "未"}`;
      }
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      await supabase.from("line_inbound_messages")
        .update({ ai_processed: true, ai_error: "missing_api_key", urgency: "normal", intent: "other" })
        .eq("id", inbound_id);
      return new Response(JSON.stringify({ error: "missing_api_key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `あなたは美容サロンのコンシェルジュアシスタントです。
お客様からの受信メッセージを冷静に分析し、意図・緊急度・要約・推奨アクションを判定します。

【意図の種類】
- booking_request: 新規予約希望
- reschedule: 予約日時の変更希望
- cancel: 予約キャンセル希望
- question: メニュー/料金/アクセス等の質問
- complaint: クレーム・不満・体調不良の訴え
- thanks: お礼・好意的な感想
- chitchat: 雑談・スタンプのみ
- other: その他

【緊急度】
- critical: 当日のキャンセル/変更、クレーム、体調不良、怒り → 即時対応必須
- high: 翌日〜数日以内の予約調整、具体的な質問 → 数時間以内に対応
- normal: 一般的な問合せ、お礼 → 営業時間内に対応
- low: 雑談、スタンプ、社交的なメッセージ`;

    const userPrompt = `# 受信メッセージ
${inbound.message_text}

# 顧客文脈
${customerCtx || "（未連携の方）"}

このメッセージを分析してください。要約は30文字以内、推奨アクションは50文字以内で。`;

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
            name: "classify",
            description: "受信メッセージの分類結果",
            parameters: {
              type: "object",
              properties: {
                intent: { type: "string", enum: ["booking_request","reschedule","cancel","question","complaint","thanks","chitchat","other"] },
                urgency: { type: "string", enum: ["critical","high","normal","low"] },
                summary: { type: "string", description: "30文字以内の要約" },
                suggested_action: { type: "string", description: "オーナーへの推奨対応（50文字以内）" },
              },
              required: ["intent","urgency","summary","suggested_action"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "classify" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("ai gateway error:", res.status, t);
      await supabase.from("line_inbound_messages")
        .update({ ai_processed: true, ai_error: `gateway_${res.status}` })
        .eq("id", inbound_id);
      return new Response(JSON.stringify({ error: "ai_error", status: res.status }), {
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
      await supabase.from("line_inbound_messages")
        .update({ ai_processed: true, ai_error: "no_classification", urgency: "normal", intent: "other" })
        .eq("id", inbound_id);
      return new Response(JSON.stringify({ error: "no_classification" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("line_inbound_messages")
      .update({
        ai_processed: true,
        intent: parsed.intent,
        urgency: parsed.urgency,
        summary: parsed.summary,
        suggested_action: parsed.suggested_action,
      })
      .eq("id", inbound_id);

    // critical / high はオーナーへメール通知
    if (parsed.urgency === "critical" || parsed.urgency === "high") {
      const { data: prof } = await supabase
        .from("profiles")
        .select("owner_notification_email, salon_name")
        .eq("id", inbound.owner_id)
        .maybeSingle();
      const notifyTo = prof?.owner_notification_email;
      if (notifyTo) {
        const urgencyLabel = parsed.urgency === "critical" ? "🚨 緊急" : "⚠️ 要対応";
        const intentLabels: Record<string,string> = {
          booking_request: "新規予約希望", reschedule: "日時変更希望", cancel: "キャンセル希望",
          question: "ご質問", complaint: "クレーム/お困りごと", thanks: "お礼",
          chitchat: "雑談", other: "その他",
        };
        try {
          const r = await invokeInternal("send-transactional-email", {
            to: notifyTo,
            subject: `${urgencyLabel} LINE: ${intentLabels[parsed.intent] || parsed.intent} - ${parsed.summary}`,
            html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:${parsed.urgency === "critical" ? "#c0392b" : "#d68910"}">${urgencyLabel} LINE受信通知</h2>
  <p style="color:#555">${prof?.salon_name || "サロン"}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;background:#f5f5f5;width:120px"><b>意図</b></td><td style="padding:8px">${intentLabels[parsed.intent] || parsed.intent}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5"><b>要約</b></td><td style="padding:8px">${parsed.summary}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5"><b>推奨対応</b></td><td style="padding:8px">${parsed.suggested_action}</td></tr>
  </table>
  <div style="border-left:3px solid #C9A961;padding:12px 16px;background:#faf8f3;margin:16px 0">
    <p style="margin:0;color:#555;font-size:12px">受信メッセージ全文</p>
    <p style="margin:8px 0 0;white-space:pre-wrap">${(inbound.message_text || "").slice(0, 1000)}</p>
  </div>
  <p style="font-size:12px;color:#888">管理画面の「受信トレイ」からAI下書きで返信できます。</p>
</div>`,
            template_name: "line_inbound_alert",
          }, { timeoutMs: 15000 });
          if (!r.ok) console.error("[ai-classify-inbound] notify email fail", r);
        } catch (e) {
          console.error("notify email error:", e);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, ...parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-classify-inbound error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
