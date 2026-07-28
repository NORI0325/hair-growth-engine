import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

const MAX_SYNCHRONOUS_RECIPIENTS = 500;

function tokyoDateOffset(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const identity = await authenticateRequest(req, supabase);
  if (identity.kind !== "user") {
    return new Response(JSON.stringify({ success: false, message: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const ownerId = typeof body?.owner_id === "string" ? body.owner_id : "";
    const locationId = typeof body?.location_id === "string" ? body.location_id : "";
    const message: string = (body?.message || "").toString().trim();
    const segment: string = (body?.segment || "all").toString();
    const customerIds: string[] = Array.isArray(body?.customer_ids) ? body.customer_ids.filter((x: any) => typeof x === "string") : [];

    if (!ownerId || !locationId || !(await canAccessOwner(supabase, identity.userId, ownerId, ["owner", "manager", "super_admin"]))) {
      return new Response(JSON.stringify({ success: false, message: "配信権限を確認してください" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: location } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("tenant_id", ownerId)
      .maybeSingle();
    if (!location) {
      return new Response(JSON.stringify({ success: false, message: "店舗が見つかりません" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
      .eq("id", ownerId)
      .maybeSingle();

    const token = (profile as any)?.line_channel_access_token;
    if (!token) {
      return new Response(JSON.stringify({ success: false, message: "LINEチャネルアクセストークンが未設定です" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const applyTargetFilters = (initialQuery: any) => {
      let query = initialQuery
        .eq("owner_id", ownerId)
        .eq("location_id", locationId)
        .not("line_user_id", "is", null)
        .eq("is_test", false)
        .or("opt_out_automation.is.null,opt_out_automation.eq.false")
        .is("line_unfollowed_at", null);
      if (customerIds.length > 0) {
        query = query.in("id", customerIds);
      } else {
      if (segment === "active") {
          query = query.gte("last_visit_date", tokyoDateOffset(-90));
      } else if (segment === "at_risk") {
          query = query.gte("last_visit_date", tokyoDateOffset(-180))
            .lt("last_visit_date", tokyoDateOffset(-90));
      } else if (segment === "dormant") {
          query = query.or(`last_visit_date.is.null,last_visit_date.lt.${tokyoDateOffset(-180)}`);
        }
      }
      return query;
    };

    const countQuery = applyTargetFilters(
      supabase.from("customers").select("id", { count: "exact", head: true }),
    );
    const { count: targetCount, error: countError } = await countQuery;
    if (countError) throw countError;
    if ((targetCount || 0) > MAX_SYNCHRONOUS_RECIPIENTS) {
      return new Response(JSON.stringify({
        success: false,
        code: "BROADCAST_RECIPIENT_LIMIT_EXCEEDED",
        message: `対象が${targetCount}名です。重複送信防止のため、永続配信キュー対応後に実行してください。`,
        recipient_count: targetCount,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const targetQuery = applyTargetFilters(
      supabase.from("customers").select("id, full_name, line_user_id, last_visit_date, location_id"),
    );
    const { data: targets, error: targetError } = await targetQuery.range(0, Math.max((targetCount || 1) - 1, 0));
    if (targetError) throw targetError;
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
        owner_id: ownerId,
        location_id: (c as any).location_id ?? null,
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
