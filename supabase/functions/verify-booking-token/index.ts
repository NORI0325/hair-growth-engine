import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
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
      return new Response(JSON.stringify({ error: "Token not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("id, full_name, owner_id, location_id")
      .eq("id", tokenRow.customer_id)
      .maybeSingle();

    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 店舗別の設定を優先取得（location_id があれば）。なければ profiles にフォールバック
    let locationData: any = null;
    if (customer.location_id) {
      const { data: loc } = await supabase
        .from("locations")
        .select("id, name, public_slug, open_time, close_time")
        .eq("id", customer.location_id)
        .maybeSingle();
      locationData = loc;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("salon_name, public_slug, open_time, close_time, booking_lead_time_hours, booking_max_days_ahead, allow_customer_cancel")
      .eq("id", customer.owner_id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        customer: { id: customer.id, full_name: customer.full_name },
        owner_id: customer.owner_id,
        location_id: customer.location_id || null,
        salon_name: locationData?.name || profile?.salon_name || "Salon",
        public_slug: locationData?.public_slug || profile?.public_slug || null,
        open_time: locationData?.open_time || profile?.open_time || "10:00:00",
        close_time: locationData?.close_time || profile?.close_time || "19:00:00",
        booking_lead_time_hours: (profile as any)?.booking_lead_time_hours ?? 24,
        booking_max_days_ahead: (profile as any)?.booking_max_days_ahead ?? 60,
        allow_customer_cancel: (profile as any)?.allow_customer_cancel ?? true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("verify-booking-token error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
