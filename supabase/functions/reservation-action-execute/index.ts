// ワンタイムトークンによる予約承認・別日提案・却下の実行
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";
import { verifyActionToken, hashToken } from "../_shared/reservation-token.ts";

interface Body {
  token: string;
  // approve
  confirmed_date?: string;
  confirmed_time?: string;
  confirmed_menu?: string;
  extra_message?: string;
  // propose
  proposal_message?: string;
  // reject
  rejection_reason?: string;
  reject_message?: string;
}

function jpDate(ymd?: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || "";
  const [, m, d] = ymd.split("-");
  const date = new Date(`${ymd}T00:00:00+09:00`);
  const w = ["日","月","火","水","木","金","土"][date.getDay()];
  return `${Number(m)}月${Number(d)}日(${w})`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.token) {
    return new Response(JSON.stringify({ error: "missing_token" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await verifyActionToken(body.token);
  if (!payload) {
    return new Response(JSON.stringify({ error: "invalid_or_expired_token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const tokenHash = await hashToken(body.token);
  const { data: tokenRow } = await supabase
    .from("reservation_action_tokens")
    .select("id, used_at, expires_at, action, request_id, owner_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: "token_not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (tokenRow.used_at) {
    return new Response(JSON.stringify({ error: "token_already_used" }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "token_expired" }), {
      status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 仮予約取得
  const { data: rr } = await supabase
    .from("reservation_requests")
    .select("*")
    .eq("id", tokenRow.request_id)
    .maybeSingle();
  if (!rr) {
    return new Response(JSON.stringify({ error: "request_not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (rr.status === "completed" || rr.status === "rejected") {
    return new Response(JSON.stringify({ error: "already_processed", status: rr.status }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: owner } = await supabase
    .from("profiles")
    .select("salon_name")
    .eq("id", rr.owner_id)
    .maybeSingle();
  const salonName = owner?.salon_name || "サロン";
  // location_id 解決：reservation_requests → customers → null
  let locationId: string | null = (rr as any).location_id || null;
  if (!locationId && rr.customer_id) {
    const { data: cu } = await supabase.from("customers").select("location_id").eq("id", rr.customer_id).maybeSingle();
    locationId = (cu as any)?.location_id || null;
  }
  const creds = await getLineCredentials(supabase, rr.owner_id, locationId);
  const accessToken = creds?.accessToken;
  const customerName = rr.display_name || "お客様";

  const action = tokenRow.action as "approve" | "propose" | "reject";
  let result: any = { success: true, action };

  // ============= APPROVE =============
  if (action === "approve") {
    if (!body.confirmed_date || !body.confirmed_time) {
      return new Response(JSON.stringify({ error: "missing_date_time" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const menu = body.confirmed_menu || rr.desired_menu || "ご相談";

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .insert({
        owner_id: rr.owner_id,
        location_id: locationId,
        customer_id: rr.customer_id,
        booking_date: body.confirmed_date,
        booking_time: body.confirmed_time,
        menu: menu.slice(0, 200),
        menus: rr.desired_menu_items || [menu],
        status: "confirmed",
        notes: `LINEワンタイムリンク承認: ${rr.raw_message?.slice(0, 200) || ""}`,
        external_source: "line",
      })
      .select("id")
      .maybeSingle();

    if (bookingErr) {
      return new Response(JSON.stringify({ error: "booking_create_failed", detail: bookingErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sbText = `【サロンボード転記用】
お客様: ${customerName}様
日時: ${jpDate(body.confirmed_date)} ${body.confirmed_time}
メニュー: ${menu}
※ LINEより自動取込（ワンタイムリンク承認）`;

    await supabase.from("reservation_requests").update({
      status: "completed",
      confirmed_date: body.confirmed_date,
      confirmed_time: body.confirmed_time,
      confirmed_menu: menu,
      approved_at: new Date().toISOString(),
      salonboard_transfer_text: sbText,
    }).eq("id", rr.id);

    if (accessToken && rr.line_user_id) {
      const extra = body.extra_message ? `\n\n${body.extra_message}` : "";
      const replyMsg = `${customerName}様\n\nご予約が確定いたしました🌸\n\n📅 ${jpDate(body.confirmed_date)} ${body.confirmed_time}\n💇 ${menu}\n\nご来店を心よりお待ちしております。${extra}\n\n— ${salonName}`;
      const r = await sendLinePush(accessToken, rr.line_user_id, replyMsg);
      await supabase.from("line_message_log").insert({
        owner_id: rr.owner_id, location_id: locationId, customer_id: rr.customer_id, line_user_id: rr.line_user_id,
        job_type: "reservation_approved", message: replyMsg,
        status: r.ok ? "sent" : "failed", error: r.ok ? null : r.err,
      });
    }
    result.booking_id = booking?.id;
    result.salonboard_transfer_text = sbText;
  }

  // ============= PROPOSE =============
  else if (action === "propose") {
    if (!body.proposal_message) {
      return new Response(JSON.stringify({ error: "missing_proposal" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (accessToken && rr.line_user_id) {
      const replyMsg = `${customerName}様\n\nご予約のご相談ありがとうございます🌸\n\n${body.proposal_message}\n\nご都合いかがでしょうか？このトークでお返事をお待ちしております。\n\n— ${salonName}`;
      const r = await sendLinePush(accessToken, rr.line_user_id, replyMsg);
      await supabase.from("line_message_log").insert({
        owner_id: rr.owner_id, location_id: locationId, customer_id: rr.customer_id, line_user_id: rr.line_user_id,
        job_type: "reservation_proposal", message: replyMsg,
        status: r.ok ? "sent" : "failed", error: r.ok ? null : r.err,
      });
    }
    await supabase.from("reservation_requests").update({
      staff_memo: `${rr.staff_memo || ""}\n[${new Date().toISOString().slice(0,16)}] LINE提案: ${body.proposal_message.slice(0,200)}`,
    }).eq("id", rr.id);
  }

  // ============= REJECT =============
  else if (action === "reject") {
    await supabase.from("reservation_requests").update({
      status: "rejected",
      rejection_reason: body.rejection_reason || null,
      rejected_at: new Date().toISOString(),
    }).eq("id", rr.id);

    if (accessToken && rr.line_user_id) {
      const replyMsg = body.reject_message || `${customerName}様\n\nご予約のお問い合わせありがとうございます。\n\n申し訳ございません、ご希望の日時はあいにくお席が満席となっております。\n別日でのご相談を承りますので、よろしければ改めてご希望をお送りください。\n\n— ${salonName}`;
      const r = await sendLinePush(accessToken, rr.line_user_id, replyMsg);
      await supabase.from("line_message_log").insert({
        owner_id: rr.owner_id, location_id: locationId, customer_id: rr.customer_id, line_user_id: rr.line_user_id,
        job_type: "reservation_rejected", message: replyMsg,
        status: r.ok ? "sent" : "failed", error: r.ok ? null : r.err,
      });
    }
  }

  // 同じ予約の他のトークンも全て無効化
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null;
  const ua = req.headers.get("user-agent") || null;
  await supabase.from("reservation_action_tokens").update({
    used_at: new Date().toISOString(),
    used_ip: ip,
    used_ua: ua,
  }).eq("request_id", tokenRow.request_id).is("used_at", null);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
