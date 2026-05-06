import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// スタッフがアプリ内から手動で予約を作成するエンドポイント。
// - bookings 行を作成
// - 連携が有効なら sync_jobs を生成し、sync-job-dispatch を最大 SYNC_WAIT_MS 待機
// - タイムアウトしたら sync_status='pending' のままバックグラウンド処理に任せる
const SYNC_WAIT_MS = 15_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userRes } = await supabaseAuth.auth.getUser();
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const body = await req.json();
    const {
      customer_id, booking_date, booking_time, menus, staff_id, notes, location_id,
    } = body || {};

    if (!customer_id || !booking_date || !booking_time || !Array.isArray(menus) || menus.length === 0) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date) || !/^\d{2}:\d{2}$/.test(booking_time)) {
      return new Response(JSON.stringify({ error: "invalid_format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 顧客取得 → owner_id 取得（テナント検証）
    const { data: customer } = await supabase
      .from("customers").select("id, owner_id, full_name, phone, email").eq("id", customer_id).maybeSingle();
    if (!customer) {
      return new Response(JSON.stringify({ error: "customer_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // テナント所属チェック
    const { data: membership } = await supabase
      .from("tenant_members").select("user_id").eq("tenant_id", customer.owner_id).eq("user_id", userId).not("accepted_at", "is", null).maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // メニュー集計（IDベース。後方互換で文字列(name)も受け付ける）
    const rawMenus: any[] = Array.isArray(menus) ? menus.slice(0, 10) : [];
    const menuIds: string[] = rawMenus.filter((m) => typeof m === "string" && /^[0-9a-f-]{36}$/i.test(m));
    const menuNamesFallback: string[] = rawMenus.filter((m) => typeof m === "string" && !/^[0-9a-f-]{36}$/i.test(m));
    let menuRows: any[] = [];
    if (menuIds.length > 0) {
      const { data } = await supabase
        .from("menu_items").select("id, name, duration_minutes, buffer_minutes, price")
        .eq("owner_id", customer.owner_id).in("id", menuIds);
      menuRows = data || [];
    } else if (menuNamesFallback.length > 0) {
      const { data } = await supabase
        .from("menu_items").select("id, name, duration_minutes, buffer_minutes, price")
        .eq("owner_id", customer.owner_id).in("name", menuNamesFallback);
      // 同名は最初の1件のみ採用
      const seen = new Set<string>();
      menuRows = (data || []).filter((r: any) => { if (seen.has(r.name)) return false; seen.add(r.name); return true; });
    }
    let totalDuration = 0, totalPrice = 0;
    for (const r of menuRows) {
      totalDuration += (r.duration_minutes || 0) + (r.buffer_minutes || 0);
      totalPrice += (r.price || 0);
    }
    const menuNames = menuRows.map((r) => r.name);
    const menuSummary = menuNames.join(" + ").slice(0, 200);

    // bookings INSERT
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .insert({
        owner_id: customer.owner_id,
        customer_id: customer.id,
        location_id: location_id || null,
        booking_date,
        booking_time: booking_time + ":00",
        menu: menuSummary,
        menus: menuNames,
        total_duration_minutes: totalDuration || null,
        total_price: totalPrice || null,
        notes: notes ? String(notes).slice(0, 500) : null,
        staff_id: staff_id || null,
        status: "pending", // 仮受付。同期成功で confirmed に昇格
        source_channel: "manual",
        external_source: "manual",
      })
      .select()
      .single();
    if (bErr || !booking) {
      console.error("booking insert error:", bErr);
      return new Response(JSON.stringify({ error: "insert_failed", message: bErr?.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 連携チェック (location_id を含む)
    let ciQ = supabase.from("channel_integrations")
      .select("channel, location_id, default_rsv_route_id, connection_status, allow_unmapped_booking")
      .eq("owner_id", customer.owner_id).eq("enabled", true).eq("sync_enabled", true);
    const { data: integrations } = await ciQ;

    const liveIntegrations = (integrations || []).filter((ci: any) =>
      ci.channel !== "own_web" && ci.connection_status === "live"
      && (ci.location_id == null || ci.location_id === (location_id || null)));

    if (!liveIntegrations || liveIntegrations.length === 0) {
      // 同期対象なし → 即 confirmed
      await supabase.from("bookings").update({ status: "confirmed", sync_status: "not_required" }).eq("id", booking.id);
      return new Response(JSON.stringify({
        success: true, booking_id: booking.id, sync_status: "not_required", status: "confirmed",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // sync_jobs 生成
    const startISO = new Date(`${booking_date}T${booking_time}:00+09:00`).toISOString();
    const endISO = new Date(new Date(`${booking_date}T${booking_time}:00+09:00`).getTime() + (totalDuration || 60) * 60_000).toISOString();
    const { data: staffRow } = staff_id
      ? await supabase.from("staff").select("name").eq("id", staff_id).maybeSingle() : { data: null };

    const jobsToInsert: any[] = [];
    for (const ci of liveIntegrations) {
      let extStaffName: string | null = null, extStaffId: string | null = null;
      if (staff_id) {
        const { data: scm } = await supabase.from("staff_channel_mappings")
          .select("external_name, external_id, enabled")
          .eq("staff_id", staff_id).eq("channel", ci.channel).maybeSingle();
        if (scm?.enabled !== false) {
          extStaffName = scm?.external_name ?? null;
          extStaffId = scm?.external_id ?? null;
        }
      }
      let extMenuName: string | null = null, extMenuId: string | null = null, rsvTerm: number | null = null;
      if (menuRows.length > 0) {
        const { data: mcm } = await supabase.from("menu_channel_mappings")
          .select("external_name, external_id, external_setmenu_id, rsv_term, enabled")
          .eq("menu_id", menuRows[0].id).eq("channel", ci.channel).maybeSingle();
        if (mcm?.enabled !== false) {
          extMenuName = mcm?.external_name ?? null;
          extMenuId = mcm?.external_setmenu_id || mcm?.external_id || null;
          rsvTerm = mcm?.rsv_term ?? null;
        }
      }
      jobsToInsert.push({
        owner_id: customer.owner_id,
        location_id: location_id || null,
        reservation_id: booking.id,
        target_channel: ci.channel,
        job_type: "create_reservation",
        status: "pending",
        request_payload: {
          customer_name: customer.full_name,
          customer_phone: customer.phone,
          customer_email: customer.email,
          start_time: startISO,
          end_time: endISO,
          staff_name: staffRow?.name ?? null,
          external_staff_name: extStaffName,
          external_staff_id: extStaffId,
          menu_name: menuSummary,
          external_menu_name: extMenuName,
          external_menu_id: extMenuId,
          rsv_term: rsvTerm,
          rsv_route_id: ci.default_rsv_route_id || "K000000001",
          notes: notes ? String(notes).slice(0, 500) : null,
          source_channel: "manual",
        },
      });
    }
    if (jobsToInsert.length === 0) {
      await supabase.from("bookings").update({ status: "confirmed", sync_status: "not_required" }).eq("id", booking.id);
      return new Response(JSON.stringify({
        success: true, booking_id: booking.id, sync_status: "not_required", status: "confirmed",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    await supabase.from("sync_jobs").insert(jobsToInsert);
    await supabase.from("bookings").update({ sync_status: "pending" }).eq("id", booking.id);

    // dispatch を最大 SYNC_WAIT_MS 待機
    const dispatchPromise = supabase.functions.invoke("sync-job-dispatch", { body: { reservation_id: booking.id } });
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), SYNC_WAIT_MS));
    const winner = await Promise.race([dispatchPromise, timeout]);

    // 結果を bookings から再取得
    const { data: refreshed } = await supabase
      .from("bookings").select("sync_status, sync_error_message, external_reservation_id, needs_manual_review")
      .eq("id", booking.id).maybeSingle();

    let finalBookingStatus = "pending";
    if (refreshed?.sync_status === "success") finalBookingStatus = "confirmed";
    else if (refreshed?.sync_status === "needs_review" || refreshed?.sync_status === "failed") finalBookingStatus = "pending"; // スタッフ確認に回す
    if (winner === "timeout") finalBookingStatus = "pending";

    if (finalBookingStatus === "confirmed") {
      await supabase.from("bookings").update({ status: "confirmed" }).eq("id", booking.id);
    }

    return new Response(JSON.stringify({
      success: true,
      booking_id: booking.id,
      status: finalBookingStatus,
      sync_status: winner === "timeout" ? "pending" : (refreshed?.sync_status || "pending"),
      external_reservation_id: refreshed?.external_reservation_id || null,
      sync_error_message: refreshed?.sync_error_message || null,
      timed_out: winner === "timeout",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("staff-create-booking error:", e);
    return new Response(JSON.stringify({ error: "Internal error", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
