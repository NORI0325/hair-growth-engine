import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

// サポート問い合わせ送信
// - tickets テーブルに保存
// - support@saronboost.com にメール送信（send-transactional-email 経由）
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { subject, message, route, contextData, aiChatHistory } = await req.json();
    if (!subject || !message || message.length > 5000) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // owner_id 解決：ユーザーが所属する最初のテナント（自身のidも含む）
    const { data: prof } = await supabase.from("profiles").select("id, salon_name, full_name").eq("id", user.id).maybeSingle();
    const ownerId = prof?.id ?? user.id;

    const { data: ticket, error: insErr } = await supabase.from("support_tickets").insert({
      owner_id: ownerId,
      user_id: user.id,
      user_email: user.email ?? "",
      user_name: prof?.full_name ?? null,
      subject,
      message,
      context_route: route ?? null,
      context_data: contextData ?? null,
      ai_chat_history: aiChatHistory ?? null,
    }).select().single();
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 運営にメール通知（送信失敗してもticket自体は成功扱い）
    try {
      const historyTxt = Array.isArray(aiChatHistory)
        ? aiChatHistory.map((m: any) => `[${m.role}] ${m.content}`).join("\n\n").slice(0, 4000)
        : "";
      const html = `
        <h2>新しいサポート問い合わせ</h2>
        <p><b>件名:</b> ${escapeHtml(subject)}</p>
        <p><b>テナント:</b> ${escapeHtml(prof?.salon_name ?? "-")} (${ownerId})</p>
        <p><b>ユーザー:</b> ${escapeHtml(prof?.full_name ?? "-")} &lt;${escapeHtml(user.email ?? "")}&gt;</p>
        <p><b>画面:</b> ${escapeHtml(route ?? "-")}</p>
        <hr/>
        <p><b>本文:</b></p>
        <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message)}</pre>
        ${historyTxt ? `<hr/><p><b>AIチャット履歴:</b></p><pre style="white-space:pre-wrap;font-family:inherit;background:#f5f5f5;padding:8px">${escapeHtml(historyTxt)}</pre>` : ""}
      `;
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          to: "support@saronboost.com",
          subject: `[サポート] ${subject}`,
          html,
          purpose: "transactional",
          template_name: "support_ticket",
          reply_to: user.email,
        },
      });
    } catch (e) {
      console.error("notify email failed", e);
    }

    return new Response(JSON.stringify({ ok: true, ticketId: ticket.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
