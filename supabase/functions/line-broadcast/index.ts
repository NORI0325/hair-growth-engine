import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ success: false, message: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ success: false, message: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const message: string = (body?.message || "").toString().trim();
    const segment: string = (body?.segment || "all").toString();

    if (!message || message.length < 2) {
      return new Response(JSON.stringify({ success: false, message: "メッセージを入力してください" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (message.length > 1000) {
      return new Response(JSON.stringify({ success: false, message: "1000文字以内にしてください" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("line_channel_access_token, salon_name")
      .eq("id", user.id)
      .maybeSingle();

    const token = (profile as any)?.line_channel_access_token;
    if (!token) {
      return new Response(JSON.stringify({ success: false, message: "LINEチャネルアクセストークンが未設定です" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let q = supabase.from("customers")
      .select("id, full_name, line_user_id, last_visit_date")
      .eq("owner_id", user.id)
      .not("line_user_id", "is", null)
      .eq("is_test", false);

    const today = new Date();
    if (segment === "active") {
      const c = new Date(today); c.setDate(c.getDate() - 90);
      q = q.gte("last_visit_date", c.toISOString().split("T")[0]);
    } else if (segment === "at_risk") {
      const c1 = new Date(today); c1.setDate(c1.getDate() - 180);
      const c2 = new Date(today); c2.setDate(c2.getDate() - 90);
      q = q.gte("last_visit_date", c1.toISOString().split("T")[0])
           .lt("last_visit_date", c2.toISOString().split("T")[0]);
    } else if (segment === "dormant") {
      const c = new Date(today); c.setDate(c.getDate() - 180);
      q = q.lt("last_visit_date", c.toISOString().split("T")[0]);
    }

    const { data: targets } = await q.limit(2000);
    // LINE User IDは "U" + 32桁の英数字。それ以外（旧LINE ID等）は除外する
    const isValidLineUserId = (s: string | null) => !!s && /^U[0-9a-f]{32}$/i.test(s);
    const list = (targets || []).filter(c => isValidLineUserId(c.line_user_id));
    const skipped = (targets || []).length - list.length;

    let sent = 0, failed = 0;
    const logs: any[] = [];

    for (const c of list) {
      const personalText = message.replace(/\{\{name\}\}/g, c.full_name || "お客様");
      const r = await sendLinePush(token, c.line_user_id!, personalText);
      if (r.ok) sent++; else failed++;
      logs.push({
        owner_id: user.id,
        customer_id: c.id,
        job_type: "broadcast",
        line_user_id: c.line_user_id,
        message: personalText,
        status: r.ok ? "sent" : "failed",
        error: r.ok ? null : r.err,
      });
      // LINE rate-limit safety
      await new Promise(res => setTimeout(res, 60));
    }

    if (logs.length > 0) {
      await supabase.from("line_message_log").insert(logs as any);
    }

    return new Response(JSON.stringify({ success: true, total: list.length, sent, failed, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[line-broadcast] error", e);
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
