import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

// 公開：予約変更（新規/更新/キャンセル）時にオーナーへメール通知
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // テスト送信モード：DBを参照せずダミーデータでメールだけ送る
    if (body?.test === true) {
      const recipient = body.recipientEmail;
      if (!recipient) {
        return new Response(JSON.stringify({ error: "no_recipient" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "booking-alert-owner",
          recipientEmail: recipient,
          idempotencyKey: `owner-alert-test-${Date.now()}`,
          templateData: {
            eventType: "created",
            customerName: "テスト 太郎",
            customerPhone: "090-0000-0000",
            bookingDate: new Date().toISOString().slice(0, 10),
            bookingTime: "14:00",
            menu: "カット＋カラー（テスト送信）",
            notes: "これはテスト送信です。実際の予約は入っていません。",
            salonName: body.salonName ?? undefined,
          },
        },
      });
      if (error) {
        console.error("test send error:", error);
        return new Response(JSON.stringify({ error: "send_failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, test: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bookingId, eventType } = body;
    if (!bookingId || !["created", "updated", "cancelled"].includes(eventType)) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, owner_id, booking_date, booking_time, menu, notes, customer_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) {
      return new Response(JSON.stringify({ error: "booking_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: profile }, { data: customer }] = await Promise.all([
      supabase.from("profiles").select("salon_name, owner_notification_email").eq("id", booking.owner_id).maybeSingle(),
      supabase.from("customers").select("full_name, phone").eq("id", booking.customer_id).maybeSingle(),
    ]);

    const recipient = profile?.owner_notification_email;
    if (!recipient) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_recipient" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const templateData = {
      eventType,
      customerName: customer?.full_name ?? "お客様",
      customerPhone: customer?.phone ?? undefined,
      bookingDate: booking.booking_date,
      bookingTime: String(booking.booking_time).slice(0, 5),
      menu: booking.menu,
      notes: booking.notes ?? undefined,
      salonName: profile?.salon_name ?? undefined,
    };

    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "booking-alert-owner",
        recipientEmail: recipient,
        idempotencyKey: `owner-alert-${eventType}-${bookingId}`,
        templateData,
      },
    });

    if (error) {
      console.error("notify-owner-booking invoke error:", error);
      return new Response(JSON.stringify({ error: "send_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("notify-owner-booking error:", e);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
