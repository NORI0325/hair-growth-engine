import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { token, date, time, notes, staff_id } = body;
    let menus: string[] = Array.isArray(body.menus) ? body.menus.filter((m: any) => typeof m === "string").slice(0, 10) : [];
    // 旧クライアント互換: 単一menu文字列が来たら配列化
    if (menus.length === 0 && typeof body.menu === "string" && body.menu.trim()) {
      menus = [body.menu.trim()];
    }

    if (!token || !date || !time || menus.length === 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return new Response(JSON.stringify({ error: "Invalid date/time format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow } = await supabase
      .from("booking_tokens")
      .select("customer_id")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("id, owner_id")
      .eq("id", tokenRow.customer_id)
      .maybeSingle();

    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // メニュー合計を計算
    const { data: menuRows } = await supabase
      .from("menu_items")
      .select("name, duration_minutes, buffer_minutes, price")
      .eq("owner_id", customer.owner_id)
      .in("name", menus);
    let totalDuration = 0, totalPrice = 0;
    for (const r of (menuRows || [])) {
      totalDuration += (r.duration_minutes || 0) + (r.buffer_minutes || 0);
      totalPrice += (r.price || 0);
    }
    const menuSummary = menus.join(" + ").slice(0, 200);

    // 過去日ブロック（JST基準で当日0時より前を弾く）
    const todayJST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const todayStr = `${todayJST.getFullYear()}-${String(todayJST.getMonth()+1).padStart(2,"0")}-${String(todayJST.getDate()).padStart(2,"0")}`;
    if (date < todayStr) {
      return new Response(JSON.stringify({ error: "past_date", message: "過去の日付はご指定いただけません。" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 営業時間 / 定休日チェック
    const reqWeekday = new Date(`${date}T00:00:00+09:00`).getDay();
    const { data: salonHours } = await supabase
      .from("salon_hours")
      .select("open_time, close_time, closed")
      .eq("owner_id", customer.owner_id)
      .eq("weekday", reqWeekday)
      .maybeSingle();
    if (salonHours?.closed) {
      return new Response(JSON.stringify({ error: "closed_day", message: "ご指定の日は定休日です。別の日をお選びください。" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (salonHours) {
      const reqEndTimeStr = (() => {
        const e = new Date(`${date}T${time}:00+09:00`);
        e.setMinutes(e.getMinutes() + (totalDuration || 60));
        return `${String(e.getHours()).padStart(2,"0")}:${String(e.getMinutes()).padStart(2,"0")}:00`;
      })();
      if (`${time}:00` < salonHours.open_time || reqEndTimeStr > salonHours.close_time) {
        return new Response(JSON.stringify({ error: "out_of_hours", message: "営業時間外のためご予約いただけません。" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 予約ルール取得（リードタイム検証）
    const { data: ownerProf } = await supabase
      .from("profiles")
      .select("booking_lead_time_hours, booking_max_days_ahead")
      .eq("id", customer.owner_id)
      .maybeSingle();
    const leadHours = (ownerProf as any)?.booking_lead_time_hours ?? 24;
    const maxDays = (ownerProf as any)?.booking_max_days_ahead ?? 60;
    const reqStartCheck = new Date(`${date}T${time}:00+09:00`);
    const earliest = new Date(Date.now() + leadHours * 3600_000);
    const latest = new Date(Date.now() + maxDays * 86400_000);
    if (reqStartCheck < earliest) {
      return new Response(JSON.stringify({ error: "too_soon", message: `ご予約は${leadHours}時間前までに承っております。お急ぎの場合はお電話ください。` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (reqStartCheck > latest) {
      return new Response(JSON.stringify({ error: "too_far", message: `${maxDays}日先までのご予約のみ承っております。` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 指名スタッフの妥当性チェック
    let assignedStaffId: string | null = null;
    if (staff_id && typeof staff_id === "string") {
      const { data: staffRow } = await supabase
        .from("staff")
        .select("id")
        .eq("id", staff_id)
        .eq("owner_id", customer.owner_id)
        .eq("active", true)
        .eq("bookable", true)
        .maybeSingle();
      if (!staffRow) {
        return new Response(JSON.stringify({ error: "invalid_staff", message: "選択されたスタッフは現在ご予約いただけません。" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      assignedStaffId = staff_id;
    }

    // ダブルブッキング防止：指名ありはそのスタッフ、指名なしは「全スタッフ枠が埋まっていないか」をチェック
    const reqStart = new Date(`${date}T${time}:00+09:00`);
    const reqEnd = new Date(reqStart.getTime() + (totalDuration || 60) * 60_000);
    let bookingsQuery = supabase
      .from("bookings")
      .select("booking_time, total_duration_minutes, staff_id, status")
      .eq("owner_id", customer.owner_id)
      .eq("booking_date", date)
      .in("status", ["pending", "confirmed"]);
    if (assignedStaffId) bookingsQuery = bookingsQuery.eq("staff_id", assignedStaffId);
    const { data: existing } = await bookingsQuery;
    const conflict = (existing || []).some((b: any) => {
      const bStart = new Date(`${date}T${b.booking_time}+09:00`);
      const bEnd = new Date(bStart.getTime() + ((b.total_duration_minutes || 60) * 60_000));
      return bStart < reqEnd && bEnd > reqStart;
    });
    if (conflict) {
      return new Response(JSON.stringify({ error: "slot_taken", message: "申し訳ございません、その時間は満席となりました。別の時間をお選びください。" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 指名なしの場合、空いているスタッフを自動割り当て（先頭から空き枠を探す）
    if (!assignedStaffId) {
      const weekday = new Date(`${date}T00:00:00+09:00`).getDay();
      const { data: candidates } = await supabase
        .from("staff")
        .select("id, sort_order, staff_schedules!inner(weekday, start_time, end_time, active)")
        .eq("owner_id", customer.owner_id)
        .eq("active", true)
        .eq("bookable", true)
        .eq("staff_schedules.weekday", weekday)
        .eq("staff_schedules.active", true)
        .order("sort_order", { ascending: true });
      const reqTimeStr = time + ":00";
      const endTimeStr = `${String(reqEnd.getUTCHours() + 9).padStart(2, "0")}:${String(reqEnd.getUTCMinutes()).padStart(2, "0")}:00`;
      for (const c of (candidates || [])) {
        const sch = (c as any).staff_schedules?.[0];
        if (!sch) continue;
        if (reqTimeStr < sch.start_time || endTimeStr > sch.end_time) continue;
        // そのスタッフの予約が被っていないか
        const { data: bk } = await supabase
          .from("bookings")
          .select("booking_time, total_duration_minutes")
          .eq("staff_id", c.id)
          .eq("booking_date", date)
          .in("status", ["pending", "confirmed"]);
        const busy = (bk || []).some((b: any) => {
          const bs = new Date(`${date}T${b.booking_time}+09:00`);
          const be = new Date(bs.getTime() + ((b.total_duration_minutes || 60) * 60_000));
          return bs < reqEnd && be > reqStart;
        });
        if (!busy) { assignedStaffId = c.id; break; }
      }
    }

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        owner_id: customer.owner_id,
        customer_id: customer.id,
        booking_date: date,
        booking_time: time + ":00",
        menu: menuSummary,
        menus,
        total_duration_minutes: totalDuration || null,
        total_price: totalPrice || null,
        notes: notes ? String(notes).slice(0, 500) : null,
        staff_id: assignedStaffId,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("booking insert error:", error);
      return new Response(JSON.stringify({ error: "Failed to create booking" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const menu = menuSummary;

    // === 外部媒体への同期ジョブ作成（自社Web経由→他媒体へ反映） ===
    try {
      const { data: integrations } = await supabase
        .from("channel_integrations")
        .select("channel")
        .eq("owner_id", customer.owner_id)
        .eq("enabled", true)
        .eq("sync_enabled", true);

      if (integrations && integrations.length > 0) {
        // 顧客情報・スタッフ・メニューマッピング取得
        const { data: cust2 } = await supabase
          .from("customers").select("full_name, phone, email").eq("id", customer.id).maybeSingle();
        const { data: staffRow } = assignedStaffId
          ? await supabase.from("staff").select("name").eq("id", assignedStaffId).maybeSingle()
          : { data: null };
        const startISO = new Date(`${date}T${time}:00+09:00`).toISOString();
        const endISO = new Date(new Date(`${date}T${time}:00+09:00`).getTime() + (totalDuration || 60) * 60_000).toISOString();

        const jobsToInsert: any[] = [];
        for (const ci of integrations) {
          // 自媒体への自己同期はスキップ
          if (ci.channel === "own_web") continue;

          let extStaffName: string | null = null;
          let extStaffId: string | null = null;
          if (assignedStaffId) {
            const { data: scm } = await supabase.from("staff_channel_mappings")
              .select("external_name, external_id")
              .eq("staff_id", assignedStaffId).eq("channel", ci.channel).maybeSingle();
            extStaffName = scm?.external_name ?? null;
            extStaffId = scm?.external_id ?? null;
          }
          let extMenuName: string | null = null;
          if (menus.length > 0) {
            const { data: menuRow } = await supabase.from("menu_items")
              .select("id").eq("owner_id", customer.owner_id).eq("name", menus[0]).maybeSingle();
            if (menuRow?.id) {
              const { data: mcm } = await supabase.from("menu_channel_mappings")
                .select("external_name").eq("menu_id", menuRow.id).eq("channel", ci.channel).maybeSingle();
              extMenuName = mcm?.external_name ?? null;
            }
          }

          jobsToInsert.push({
            owner_id: customer.owner_id,
            reservation_id: booking.id,
            target_channel: ci.channel,
            job_type: "create_reservation",
            status: "pending",
            request_payload: {
              customer_name: cust2?.full_name,
              customer_phone: cust2?.phone,
              customer_email: cust2?.email,
              start_time: startISO,
              end_time: endISO,
              staff_name: staffRow?.name ?? null,
              external_staff_name: extStaffName,
              external_staff_id: extStaffId,
              menu_name: menuSummary,
              external_menu_name: extMenuName,
              notes: notes ? String(notes).slice(0, 500) : null,
              source_channel: "own_web",
            },
          });
        }

        if (jobsToInsert.length > 0) {
          await supabase.from("sync_jobs").insert(jobsToInsert);
          await supabase.from("bookings").update({ sync_status: "pending", source_channel: "own_web" }).eq("id", booking.id);
          // fire-and-forget dispatch
          supabase.functions.invoke("sync-job-dispatch", { body: { reservation_id: booking.id } })
            .catch((e) => console.error("dispatch error (non-fatal):", e));
        }
      }
    } catch (e) {
      console.error("sync-job creation error (non-fatal):", e);
    }

    // 予約完了時のLINE即時通知（顧客がLINE連携済みなら）
    try {
      const { data: cust } = await supabase
        .from("customers")
        .select("full_name, line_user_id, location_id")
        .eq("id", customer.id)
        .maybeSingle();
      const locationId = (cust as any)?.location_id || null;
      const creds = cust?.line_user_id
        ? await getLineCredentials(supabase, customer.owner_id, locationId)
        : null;
      const { data: prof } = await supabase
        .from("profiles")
        .select("salon_name")
        .eq("id", customer.owner_id)
        .maybeSingle();
      if (cust?.line_user_id && creds) {
        const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://hair-growth-engine.lovable.app";
        const myBookingsLink = `${APP_ORIGIN}/my-bookings/${token}`;
        const text = `🌸 ご予約ありがとうございます\n\n${cust.full_name}様\n${prof?.salon_name || "サロン"}でのご予約が確定しました。\n\n📅 ${date}\n🕐 ${time}\n💇 ${menu}\n\nお会いできるのを楽しみにお待ちしております。\n\nご予約内容を確認したい場合は、このLINEに「予約確認」と送信してください。\n変更・キャンセルをご希望の場合は、このLINEにご返信ください。スタッフが確認いたします。\n\nご予約の確認はこちら：\n→ ${myBookingsLink}`;
        const r = await sendLinePush(creds.accessToken, cust.line_user_id, text);
        await supabase.from("line_message_log").insert({
          owner_id: customer.owner_id,
          location_id: locationId,
          customer_id: customer.id,
          line_user_id: cust.line_user_id,
          job_type: "booking_created",
          message: text,
          status: r.ok ? "sent" : "failed",
          error: r.ok ? null : r.err,
        });
      }
    } catch (e) {
      console.error("LINE notification error (non-fatal):", e);
    }

    // オーナーへメール通知
    try {
      await supabase.functions.invoke("notify-owner-booking", {
        body: { bookingId: booking.id, eventType: "created" },
      });
    } catch (e) {
      console.error("owner notify error (non-fatal):", e);
    }

    return new Response(JSON.stringify({ success: true, booking_id: booking.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-booking error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
