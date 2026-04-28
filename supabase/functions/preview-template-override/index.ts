import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// テンプレート上書きのプレビューHTMLを返す（簡易レンダリング）
// 入力: { channel, template_key, override }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { channel, template_key, override = {} } = await req.json();

    const sample = {
      customerName: "山田 花子",
      salonName: "ARUNE Hair",
      bookingLink: "https://example.com/book/sample",
      menu: "カット＋カラー",
    };

    const greeting = (override.greeting || `${sample.customerName}様`).replace(/\{\{customer_name\}\}/g, sample.customerName);
    const body = (override.body || "本日はご来店ありがとうございました。").replace(/\{\{customer_name\}\}/g, sample.customerName).replace(/\{\{salon_name\}\}/g, sample.salonName).replace(/\{\{menu\}\}/g, sample.menu);
    const cta_label = override.cta_label || "ご予約はこちら";
    const cta_url = override.cta_url || sample.bookingLink;
    const signature = override.signature || sample.salonName;
    const subject = (override.subject || "ご来店ありがとうございました").replace(/\{\{customer_name\}\}/g, sample.customerName).replace(/\{\{salon_name\}\}/g, sample.salonName);

    if (channel === "line") {
      const text = `${greeting}\n\n${body}\n\n→ ${cta_label}: ${cta_url}\n\n${signature}`;
      return new Response(JSON.stringify({ preview: text, subject }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const html = `<!doctype html><html><body style="font-family: -apple-system, sans-serif; background: #f9f7f4; padding: 32px;">
      <div style="max-width: 560px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 8px;">
        <div style="border-bottom: 1px solid #d4af37; padding-bottom: 16px; margin-bottom: 24px;">
          <div style="font-size: 12px; letter-spacing: 0.2em; color: #d4af37;">${sample.salonName.toUpperCase()}</div>
        </div>
        <h1 style="font-size: 22px; color: #1a1a1a; margin: 0 0 20px;">${greeting}</h1>
        <div style="font-size: 14px; line-height: 1.8; color: #444; white-space: pre-wrap;">${body}</div>
        <div style="margin: 32px 0;">
          <a href="${cta_url}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.1em;">${cta_label}</a>
        </div>
        <div style="font-size: 12px; color: #888; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">${signature}</div>
      </div>
    </body></html>`;

    return new Response(JSON.stringify({ preview: html, subject }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
