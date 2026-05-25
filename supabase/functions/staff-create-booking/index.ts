import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// スタッフがアプリ内から手動で予約を作成するエンドポイント。
// - bookings 行を作成
// - 連携が有効なら sync_jobs を生成し、sync-job-dispatch を最大 SYNC_WAIT_MS 待機
// - タイムアウトしたら sync_status='pending' のままバックグラウンド処理に任せる
const SYNC_WAIT_MS = 15_000;
const MANAGER_ROLES = new Set(["manager", "owner", "super_admin"]);

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type MembershipRow = { user_id: string; role: string | null };
type MenuRow = {
  id: string;
  name: string;
  duration_minutes: number | null;
  buffer_minutes: number | null;
  price: number | null;
};
type ChannelIntegrationRow = {
  channel: string;
  location_id: string | null;
  default_rsv_route_id: string | null;
  connection_status: string | null;
  allow_unmapped_booking?: boolean | null;
};
type InsertedJobRow = { id: string };

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
      dispatch_mode: rawDispatchMode, is_test: rawIsTest,
    } = body || {};
    const dispatchMode: "auto" | "skip" = rawDispatchMode === "skip" ? "skip" : "auto";
    // skip の場合は強制的に is_test=true
    const isTest: boolean = dispatchMode === "skip" ? true : (rawIsTest === true);

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
      .from("customers").select("id, owner_id, full_name, name_kana, phone, email").eq("id", customer_id).maybeSingle();
    if (!customer) {
      return new Response(JSON.stringify({ error: "customer_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // location_id 必須化: 明示指定が無ければ primary location にフォールバック、それも無ければ 400
    let resolvedLocationId: string | null = location_id || null;
    if (!resolvedLocationId) {
      const { data: locs } = await supabase.from("locations")
        .select("id, is_primary, created_at")
        .eq("tenant_id", customer.owner_id)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1);
      resolvedLocationId = locs?.[0]?.id || null;
    }
    if (!resolvedLocationId) {
      return new Response(JSON.stringify({ error: "location_not_set", message: "店舗が未設定のため予約を作成できません" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    // テナント所属チェック
    const { data: membership } = await supabase
      .from("tenant_members").select("user_id, role").eq("tenant_id", customer.owner_id).eq("user_id", userId).not("accepted_at", "is", null).maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const membershipRow = membership as MembershipRow;
    if (dispatchMode === "skip" && !MANAGER_ROLES.has(String(membershipRow.role || ""))) {
      return jsonResponse({
        success: false,
        error: "STAFF_BOOKING_SKIP_REQUIRES_MANAGER",
        code: "STAFF_BOOKING_SKIP_REQUIRES_MANAGER",
        message: "dispatch_mode=skip is only available to managers.",
      }, 403);
    }

    const { data: salonboardLiveRows, error: salonboardLiveErr } = await supabase
      .from("channel_integrations")
      .select("id")
      .eq("owner_id", customer.owner_id)
      .eq("location_id", resolvedLocationId)
      .eq("channel", "salonboard")
      .eq("enabled", true)
      .eq("sync_enabled", true)
      .eq("connection_status", "live")
      .limit(1);
    if (salonboardLiveErr) {
      console.error("salonboard live check error:", salonboardLiveErr);
      return jsonResponse({
        success: false,
        error: "salonboard_live_check_failed",
        message: salonboardLiveErr.message,
      }, 500);
    }
    const salonboardLive = (salonboardLiveRows || []).length > 0;

    // メニュー集計（IDベース。後方互換で文字列(name)も受け付ける）
    const requestedMenuCount = Array.isArray(menus) ? menus.length : 0;
    const rawMenus: unknown[] = Array.isArray(menus) ? menus.slice(0, 10) : [];
    const menuIds: string[] = rawMenus.filter((m) => typeof m === "string" && /^[0-9a-f-]{36}$/i.test(m));
    const menuNamesFallback: string[] = rawMenus.filter((m) => typeof m === "string" && !/^[0-9a-f-]{36}$/i.test(m));
    let menuRows: MenuRow[] = [];
    if (menuIds.length > 0) {
      const { data } = await supabase
        .from("menu_items").select("id, name, duration_minutes, buffer_minutes, price")
        .eq("owner_id", customer.owner_id)
        .eq("location_id", resolvedLocationId)
        .eq("active", true)
        .in("id", menuIds);
      menuRows = (data || []) as MenuRow[];
    } else if (menuNamesFallback.length > 0) {
      const { data } = await supabase
        .from("menu_items").select("id, name, duration_minutes, buffer_minutes, price")
        .eq("owner_id", customer.owner_id)
        .eq("location_id", resolvedLocationId)
        .eq("active", true)
        .in("name", menuNamesFallback);
      // 同名は最初の1件のみ採用
      const seen = new Set<string>();
      menuRows = ((data || []) as MenuRow[]).filter((r) => { if (seen.has(r.name)) return false; seen.add(r.name); return true; });
    }
    if (salonboardLive) {
      if (requestedMenuCount !== 1) {
        return jsonResponse({
          success: false,
          error: "STAFF_BOOKING_MULTIPLE_MENUS_NOT_SUPPORTED_FOR_SALONBOARD",
          code: "STAFF_BOOKING_MULTIPLE_MENUS_NOT_SUPPORTED_FOR_SALONBOARD",
          message: "この店舗では同期可能なメニューを1つ選択してください。",
        }, 409);
      }
      if (menuRows.length !== 1) {
        return jsonResponse({
          success: false,
          error: "STAFF_BOOKING_MENU_NOT_SYNCABLE_TO_SALONBOARD",
          code: "STAFF_BOOKING_MENU_NOT_SYNCABLE_TO_SALONBOARD",
          message: "このメニューはサロンボードへ同期できません。",
        }, 409);
      }

      const selectedMenu = menuRows[0];
      const { data: mcm, error: mcmErr } = await supabase
        .from("menu_channel_mappings")
        .select("external_id, external_setmenu_id, rsv_term, enabled")
        .eq("owner_id", customer.owner_id)
        .eq("menu_id", selectedMenu.id)
        .eq("channel", "salonboard")
        .eq("enabled", true)
        .not("rsv_term", "is", null)
        .maybeSingle();
      if (mcmErr) {
        console.error("staff booking menu mapping check error:", mcmErr);
        return jsonResponse({
          success: false,
          error: "STAFF_BOOKING_MENU_MAPPING_REQUIRED",
          code: "STAFF_BOOKING_MENU_MAPPING_REQUIRED",
          message: "メニューのサロンボード同期設定を確認できませんでした。",
        }, 500);
      }

      const setmenuId = String(mcm?.external_setmenu_id || mcm?.external_id || "").trim();
      if (!mcm || !setmenuId || !/^SN/i.test(setmenuId) || mcm.rsv_term == null) {
        return jsonResponse({
          success: false,
          error: "STAFF_BOOKING_MENU_NOT_SYNCABLE_TO_SALONBOARD",
          code: "STAFF_BOOKING_MENU_NOT_SYNCABLE_TO_SALONBOARD",
          message: "このメニューはサロンボードへ同期できません。",
        }, 409);
      }

      const { count: optionCount, error: optionErr } = await supabase
        .from("channel_menu_options")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", customer.owner_id)
        .eq("location_id", resolvedLocationId)
        .eq("channel", "salonboard")
        .eq("source_type", "setmenu")
        .eq("setmenu_id", setmenuId)
        .not("rsv_term", "is", null);
      if (optionErr) {
        console.error("staff booking channel menu option check error:", optionErr);
        return jsonResponse({
          success: false,
          error: "STAFF_BOOKING_MENU_MAPPING_REQUIRED",
          code: "STAFF_BOOKING_MENU_MAPPING_REQUIRED",
          message: "サロンボード側メニュー候補を確認できませんでした。",
        }, 500);
      }
      if (optionCount !== 1) {
        return jsonResponse({
          success: false,
          error: "STAFF_BOOKING_MENU_NOT_SYNCABLE_TO_SALONBOARD",
          code: "STAFF_BOOKING_MENU_NOT_SYNCABLE_TO_SALONBOARD",
          message: "このメニューはサロンボードへ同期できません。",
        }, 409);
      }

      selectedMenu.duration_minutes = Number(mcm.rsv_term);
      selectedMenu.buffer_minutes = 0;
    }

    let totalDuration = 0, totalPrice = 0;
    for (const r of menuRows) {
      totalDuration += (r.duration_minutes || 0) + (r.buffer_minutes || 0);
      totalPrice += (r.price || 0);
    }
    const menuNames = menuRows.map((r) => r.name);
    const menuSummary = menuNames.join(" + ").slice(0, 200);

    // notes に付与するメタタグ
    const noteParts: string[] = [];
    if (notes) noteParts.push(String(notes).slice(0, 500));
    if (dispatchMode === "skip") noteParts.push("[dispatch_mode=skip]");
    if (isTest) noteParts.push("[is_test=true][Phase2実Worker往復テスト]");
    const finalNotes = noteParts.length > 0 ? noteParts.join(" ").slice(0, 800) : null;

    // bookings INSERT
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .insert({
        owner_id: customer.owner_id,
        customer_id: customer.id,
        location_id: resolvedLocationId,
        booking_date,
        booking_time: booking_time + ":00",
        menu: menuSummary,
        menus: menuNames,
        total_duration_minutes: totalDuration || null,
        total_price: totalPrice || null,
        notes: finalNotes,
        staff_id: staff_id || null,
        status: "pending", // 仮受付。同期成功で confirmed に昇格
        sync_status: "pending",
        source_channel: "manual",
        external_source: "manual",
        is_test: isTest,
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
      .eq("owner_id", customer.owner_id).eq("enabled", true);
    if (dispatchMode === "auto") {
      ciQ = ciQ.eq("sync_enabled", true);
    }
    const { data: integrations } = await ciQ;

    const targetIntegrations = ((integrations || []) as ChannelIntegrationRow[]).filter((ci) =>
      ci.channel !== "own_web"
      && (dispatchMode === "skip" || ci.connection_status === "live")
      && ci.location_id === resolvedLocationId);

    if (dispatchMode === "auto" && (!targetIntegrations || targetIntegrations.length === 0)) {
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

    const jobsToInsert: Record<string, unknown>[] = [];
    for (const ci of targetIntegrations) {
      let extStaffName: string | null = null, extStaffId: string | null = staff_id ? null : "0000000000";
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
        location_id: resolvedLocationId,
        reservation_id: booking.id,
        target_channel: ci.channel,
        job_type: "create_reservation",
        status: "pending",
        request_payload: {
          customer_name: customer.full_name,
          customer_kana: customer.name_kana ?? null,
          customer_phone: customer.phone,
          customer_email: customer.email,
          start_time: startISO,
          end_time: endISO,
          staff_name: staffRow?.name ?? null,
          external_staff_name: extStaffName,
          external_staff_id: extStaffId,
          stylistId: extStaffId,
          menu_name: menuSummary,
          external_menu_name: extMenuName,
          external_setmenu_id: extMenuId,
          external_menu_id: extMenuId,
          salonboard_setmenu_id: extMenuId,
          setmenuId: extMenuId,
          rsvTerm,
          rsv_term: rsvTerm,
          rsv_route_id: ci.default_rsv_route_id || "K000000001",
          notes: finalNotes,
          source_channel: "manual",
          is_test: isTest,
        },
      });
    }
    if (jobsToInsert.length === 0) {
      if (dispatchMode === "skip") {
        await supabase.from("bookings").update({ sync_status: "pending" }).eq("id", booking.id);
        return new Response(JSON.stringify({
          success: true,
          booking_id: booking.id,
          status: "pending",
          sync_status: "pending",
          dispatch_mode: "skip",
          is_test: isTest,
          sync_job_ids: [],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await supabase.from("bookings").update({ status: "confirmed", sync_status: "not_required" }).eq("id", booking.id);
      return new Response(JSON.stringify({
        success: true, booking_id: booking.id, sync_status: "not_required", status: "confirmed",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: insertedJobs } = await supabase.from("sync_jobs").insert(jobsToInsert).select("id");
    await supabase.from("bookings").update({ sync_status: "pending" }).eq("id", booking.id);

    // dispatch_mode='skip' のときは Worker dispatch を呼ばずに pending のまま返す
    if (dispatchMode === "skip") {
      return new Response(JSON.stringify({
        success: true,
        booking_id: booking.id,
        status: "pending",
        sync_status: "pending",
        dispatch_mode: "skip",
        is_test: isTest,
        sync_job_ids: ((insertedJobs || []) as InsertedJobRow[]).map((j) => j.id),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
