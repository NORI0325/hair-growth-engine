import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { token, booking_id } = await req.json();
    if (!token || !booking_id) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // トークン検証
    const { data: tokenRow } = await supabase
      .from("booking_tokens").select("customer_id").eq("token", token).maybeSingle();
    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 予約取得＆所有者チェック
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, owner_id, customer_id, location_id, booking_date, booking_time, menu, status")
      .eq("id", booking_id).maybeSingle();
    if (!booking || booking.customer_id !== tokenRow.customer_id) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["pending", "confirmed"].includes(booking.status)) {
      return new Response(JSON.stringify({ error: "already_processed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // サロン設定（キャンセル許可・期限）
    const { data: profile } = await supabase
      .from("profiles")
      .select("salon_name, allow_customer_cancel, cancel_deadline_hours, owner_notification_email")
      .eq("id", booking.owner_id).maybeSingle();
    if (!profile?.allow_customer_cancel) {
      return new Response(JSON.stringify({ error: "cancel_disabled", message: "オンラインキャンセルはご利用いただけません。サロンへ直接ご連絡ください。" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 期限チェック
    const deadlineHours = profile.cancel_deadline_hours ?? 3;
    const bookingStart = new Date(`${booking.booking_date}T${booking.booking_time}+09:00`);
    const cutoff = new Date(bookingStart.getTime() - deadlineHours * 3600_000);
    if (new Date() > cutoff) {
      return new Response(JSON.stringify({ error: "past_deadline", message: `ご予約${deadlineHours}時間前を過ぎているため、オンラインでのキャンセルはできません。サロンへ直接ご連絡ください。` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // キャンセル実行
    const { error: updErr } = await supabase
      .from("bookings").update({
        status: "cancelled",
        cancelled_source: "salonboost",
        cancelled_at: new Date().toISOString(),
      }).eq("id", booking.id);
    if (updErr) {
      return new Response(JSON.stringify({ error: "update_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 顧客＆通知
    const { data: customer } = await supabase
      .from("customers").select("full_name, line_user_id, location_id").eq("id", booking.customer_id).maybeSingle();
    const salonName = profile.salon_name || "サロン";
    const locationId = booking.location_id || (customer as any)?.location_id || null;

    // 顧客向けLINE通知
    try {
      if (customer?.line_user_id) {
        const creds = await getLineCredentials(supabase, booking.owner_id, locationId);
        if (creds) {
          const text = `❌ ご予約のキャンセルを承りました\n\n${customer.full_name}様\n\n📅 ${booking.booking_date}\n🕐 ${booking.booking_time.slice(0,5)}\n💇 ${booking.menu}\n\nまたのご来店を心よりお待ちしております。\n${salonName}`;
          const r = await sendLinePush(creds.accessToken, customer.line_user_id, text);
          await supabase.from("line_message_log").insert({
            owner_id: booking.owner_id,
            location_id: locationId,
            customer_id: booking.customer_id,
            line_user_id: customer.line_user_id,
            job_type: "booking_cancelled",
            message: text,
            status: r.ok ? "sent" : "failed",
            error: r.ok ? null : r.err,
          });
        }
      }
    } catch (e) { console.error("LINE cancel notify error:", e); }

    // オーナー通知
    try {
      await supabase.functions.invoke("notify-owner-booking", {
        body: { bookingId: booking.id, eventType: "cancelled_by_customer" },
      });
    } catch (e) { console.error("owner notify error:", e); }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cancel-booking error:", e);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
