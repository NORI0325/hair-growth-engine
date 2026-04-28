import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush } from "../_shared/line-push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, date, time, menu, notes } = await req.json();

    if (!token || !date || !time || !menu) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 日付・時間バリデーション
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

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        owner_id: customer.owner_id,
        customer_id: customer.id,
        booking_date: date,
        booking_time: time + ":00",
        menu: String(menu).slice(0, 200),
        notes: notes ? String(notes).slice(0, 500) : null,
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

    // 予約完了時のLINE即時通知（顧客がLINE連携済みなら）
    try {
      const { data: cust } = await supabase
        .from("customers")
        .select("full_name, line_user_id")
        .eq("id", customer.id)
        .maybeSingle();
      const { data: prof } = await supabase
        .from("profiles")
        .select("salon_name, line_channel_access_token")
        .eq("id", customer.owner_id)
        .maybeSingle();
      if (cust?.line_user_id && prof?.line_channel_access_token) {
        const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://hair-growth-engine.lovable.app";
        const bookingLink = `${APP_ORIGIN}/book/${token}`;
        const text = `🌸 ご予約ありがとうございます\n\n${cust.full_name}様\n${prof.salon_name || "サロン"}でのご予約が確定しました。\n\n📅 ${date}\n🕐 ${time}\n💇 ${menu}\n\nお会いできるのを楽しみにお待ちしております。\n\n変更・キャンセルはこちら：\n→ ${bookingLink}`;
        await sendLinePush(prof.line_channel_access_token, cust.line_user_id, text);
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
