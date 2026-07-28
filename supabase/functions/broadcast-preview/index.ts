import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { applySegmentFilter, buildFilterContext, type SegmentInput } from "../_shared/segment-filter.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

// 送信前の対象人数プレビュー専用関数。実送信は行わない。
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const identity = await authenticateRequest(req, supabase);
  if (identity.kind !== "user") {
    return new Response(JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const ownerId = typeof body?.owner_id === "string" ? body.owner_id : "";
    const locationId = typeof body?.location_id === "string" ? body.location_id : "";
    const customerIds: string[] = Array.isArray(body?.customer_ids)
      ? body.customer_ids.filter((x: any) => typeof x === "string") : [];
    const seg: SegmentInput = (body?.segment || {}) as SegmentInput;
    const skipRecentDays: number = Number.isFinite(Number(body?.skip_recent_days)) && Number(body?.skip_recent_days) > 0
      ? Math.min(90, Math.floor(Number(body.skip_recent_days))) : 0;
    const excludeRecentBookingDays: number = Number.isFinite(Number(body?.exclude_recent_booking_days)) && Number(body?.exclude_recent_booking_days) > 0
      ? Math.min(90, Math.floor(Number(body.exclude_recent_booking_days))) : 0;

    if (!ownerId || !locationId || !(await canAccessOwner(supabase, identity.userId, ownerId, ["owner", "manager", "super_admin"]))) {
      return new Response(JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: location } = await supabase.from("locations").select("id")
      .eq("id", locationId).eq("tenant_id", ownerId).maybeSingle();
    if (!location || customerIds.length > 500) {
      return new Response(JSON.stringify({ error: "Invalid location or too many customers" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (customerIds.length === 0) {
      return new Response(JSON.stringify({
        total: 0, line: 0, sms: 0, email: 0,
        segment_skipped: 0, recent_booking_skipped: 0, cooldown_skipped: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: targets } = await supabase.from("customers")
      .select("id, full_name, email, phone, line_user_id, line_unfollowed_at, opt_out_automation, birthday, gender, last_visit_date, visit_count, total_spent")
      .eq("owner_id", ownerId)
      .eq("location_id", locationId)
      .eq("is_test", false)
      // 販促配信: 配信停止顧客は除外
      .or("opt_out_automation.is.null,opt_out_automation.eq.false")
      .in("id", customerIds);
    const allCustomers = (targets || []) as any[];

    const ctx = await buildFilterContext(supabase, ownerId, allCustomers.map(c => c.id), excludeRecentBookingDays);
    const { matched, segmentSkipped, recentBookingSkipped } = applySegmentFilter(allCustomers, seg, ctx);

    let finalList = matched;
    let cooldownSkipped = 0;
    if (skipRecentDays > 0 && finalList.length > 0) {
      const cutoff = new Date(Date.now() - skipRecentDays * 86400000).toISOString();
      const { data: states } = await supabase
        .from("customer_communication_state")
        .select("customer_id, last_sent_at")
        .eq("owner_id", ownerId)
        .in("customer_id", finalList.map((c: any) => c.id))
        .gte("last_sent_at", cutoff);
      const recentSet = new Set((states || []).map((s: any) => s.customer_id));
      const before = finalList.length;
      finalList = finalList.filter((c: any) => !recentSet.has(c.id));
      cooldownSkipped = before - finalList.length;
    }

    const isValidLineUserId = (s: string | null | undefined) => !!s && /^U[0-9a-f]{32}$/i.test(s);
    // LINE: 解除済みは除外
    const lineCount = finalList.filter((c) => isValidLineUserId(c.line_user_id) && !c.line_unfollowed_at).length;
    const smsCount = finalList.filter((c) => !!c.phone).length;
    const emailCount = finalList.filter((c) => !!c.email).length;

    return new Response(JSON.stringify({
      total: finalList.length,
      line: lineCount,
      sms: smsCount,
      email: emailCount,
      segment_skipped: segmentSkipped,
      recent_booking_skipped: recentBookingSkipped,
      cooldown_skipped: cooldownSkipped,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[broadcast-preview] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
