import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { invokeInternal } from "../_shared/invoke-internal.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

// サポート問い合わせ送信
// - tickets テーブルに保存
// - support@saronboost.com にメール送信（send-transactional-email 経由）
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const identity = await authenticateRequest(req, supabase);
    if (identity.kind !== "user") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.admin.getUserById(identity.userId);
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenant_id, location_id, subject, message, route, contextData, aiChatHistory } = await req.json();
    if (!subject || !message || message.length > 5000) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tenant_id || !await canAccessOwner(supabase, user.id, tenant_id)) {
      return new Response(JSON.stringify({ error: "tenant_forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (location_id) {
      const { data: location } = await supabase
        .from("locations")
        .select("id")
        .eq("id", location_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      if (!location) {
        return new Response(JSON.stringify({ error: "location_forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const [{ data: userProfile }, { data: tenantProfile }] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("salon_name").eq("id", tenant_id).maybeSingle(),
    ]);
    const ownerId = tenant_id;

    const { data: ticket, error: insErr } = await supabase.from("support_tickets").insert({
      owner_id: ownerId,
      user_id: user.id,
      user_email: user.email ?? "",
      user_name: userProfile?.full_name ?? null,
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
      await invokeInternal("send-transactional-email", {
        templateName: "internal-notification",
        recipientEmail: "support@saronboost.com",
        idempotencyKey: `support-ticket-${ticket.id}`,
        templateData: {
          subject: `[サポート] ${subject}`,
          title: "新しいサポート問い合わせ",
          salonName: tenantProfile?.salon_name ?? "-",
          message,
          details: [
            { label: "テナントID", value: ownerId },
            { label: "ユーザー", value: `${userProfile?.full_name ?? "-"} <${user.email ?? ""}>` },
            { label: "画面", value: route ?? "-" },
            ...(historyTxt ? [{ label: "AIチャット履歴", value: historyTxt }] : []),
          ],
        },
      }, { idempotencyKey: `support-ticket-${ticket.id}` });
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
