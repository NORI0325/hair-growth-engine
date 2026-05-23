// 仮予約の承認・日時調整・却下を行うEdge Function
// - approve: 確定 → bookings作成 → LINE返信 → サロンボード転記文生成
// - propose: 別日時を提案 → LINE返信のみ（仮予約は status="awaiting_approval"継続）
// - reject: 却下 → LINE返信
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendLinePush, getLineCredentials } from "../_shared/line-push.ts";

interface Body {
  request_id: string;
  action: "approve" | "propose" | "reject";
  // approve / propose 共通
  confirmed_date?: string; // YYYY-MM-DD
  confirmed_time?: string; // HH:MM
  confirmed_menu?: string;
  confirmed_staff_id?: string | null;
  // propose: 提案メッセージ
  proposal_message?: string;
  // reject
  rejection_reason?: string;
  reject_message?: string;
  // approve: 任意のメッセージ追記
  extra_message?: string;
}

function jpDate(ymd?: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || "";
  const [, m, d] = ymd.split("-");
  const date = new Date(`${ymd}T00:00:00+09:00`);
  const w = ["日","月","火","水","木","金","土"][date.getDay()];
  return `${Number(m)}月${Number(d)}日(${w})`;
}

async function assertSalonboardSyncableMenu(
  supabase: any,
  ownerId: string,
  locationId: string | null,
  menus: unknown[],
): Promise<{ ok: true } | { ok: false; status: number; error: string; message: string }> {
  if (!locationId) return { ok: true };

  const { data: salonboardIntegrations, error: salonboardLiveErr } = await supabase
    .from("channel_integrations")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("location_id", locationId)
    .eq("channel", "salonboard")
    .eq("enabled", true)
    .eq("sync_enabled", true)
    .eq("connection_status", "live")
    .limit(1);

  if (salonboardLiveErr) {
    console.error("[reservation-approve] salonboard live check error:", salonboardLiveErr);
    return {
      ok: false,
      status: 500,
      error: "salonboard_guard_failed",
      message: "予約メニューの確認に失敗しました。",
    };
  }

  const salonboardLive = (salonboardIntegrations || []).length > 0;
  if (!salonboardLive) return { ok: true };

  const selectedMenus = menus
    .filter((menu): menu is string => typeof menu === "string" && menu.trim().length > 0)
    .map((menu) => menu.trim());

  if (selectedMenus.length !== 1) {
    return {
      ok: false,
      status: 400,
      error: "salonboard_requires_single_syncable_setmenu",
      message: "この店舗では同期可能なメニューを1つ選択してください。",
    };
  }

  let syncableMenuCount = 0;
  const selectedMenuName = selectedMenus[0];

  const { data: syncableMenuRows, error: syncableMenuErr } = await supabase
    .from("menu_items")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("location_id", locationId)
    .eq("name", selectedMenuName)
    .eq("active", true);

  if (syncableMenuErr) {
    console.error("[reservation-approve] salonboard menu guard menu_items error:", syncableMenuErr);
    return {
      ok: false,
      status: 500,
      error: "salonboard_guard_failed",
      message: "予約メニューの確認に失敗しました。",
    };
  }

  const menuIds = (syncableMenuRows || []).map((row: any) => row.id).filter(Boolean);
  if (menuIds.length > 0) {
    const { data: mappings, error: mappingErr } = await supabase
      .from("menu_channel_mappings")
      .select("menu_id, external_id, external_setmenu_id, rsv_term, enabled")
      .eq("owner_id", ownerId)
      .eq("channel", "salonboard")
      .eq("enabled", true)
      .not("rsv_term", "is", null)
      .in("menu_id", menuIds);

    if (mappingErr) {
      console.error("[reservation-approve] salonboard menu guard mapping error:", mappingErr);
      return {
        ok: false,
        status: 500,
        error: "salonboard_guard_failed",
        message: "予約メニューの確認に失敗しました。",
      };
    }

    const setmenuIds = Array.from(new Set(
      (mappings || [])
        .map((mapping: any) =>
          String(mapping.external_setmenu_id || "").trim() || String(mapping.external_id || "").trim()
        )
        .filter((id: string) => /^SN/i.test(id))
    ));

    if (setmenuIds.length > 0) {
      const { data: optionRows, error: optionErr } = await supabase
        .from("channel_menu_options")
        .select("setmenu_id, rsv_term")
        .eq("owner_id", ownerId)
        .eq("location_id", locationId)
        .eq("channel", "salonboard")
        .eq("source_type", "setmenu")
        .not("rsv_term", "is", null)
        .in("setmenu_id", setmenuIds);

      if (optionErr) {
        console.error("[reservation-approve] salonboard menu guard option error:", optionErr);
        return {
          ok: false,
          status: 500,
          error: "salonboard_guard_failed",
          message: "予約メニューの確認に失敗しました。",
        };
      }

      const optionCountBySetmenuId = new Map<string, number>();
      for (const option of optionRows || []) {
        const setmenuId = String((option as any).setmenu_id || "").trim();
        if (!setmenuId) continue;
        optionCountBySetmenuId.set(setmenuId, (optionCountBySetmenuId.get(setmenuId) || 0) + 1);
      }

      for (const mapping of mappings || []) {
        const setmenuId =
          String((mapping as any).external_setmenu_id || "").trim() ||
          String((mapping as any).external_id || "").trim();
        if (!/^SN/i.test(setmenuId) || (mapping as any).rsv_term == null) continue;
        syncableMenuCount += optionCountBySetmenuId.get(setmenuId) || 0;
      }
    }
  }

  if (syncableMenuCount !== 1) {
    return {
      ok: false,
      status: 400,
      error: "salonboard_menu_not_syncable",
      message: "このメニューは現在オンライン予約できません。店舗へお問い合わせください。",
    };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 認証チェック
  const auth = req.headers.get("Authorization");
  if (!auth) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: userRes } = await userClient.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.request_id || !body.action) {
    return new Response(JSON.stringify({ error: "missing_params" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 仮予約取得
  const { data: rr, error: fetchErr } = await supabase
    .from("reservation_requests")
    .select("*")
    .eq("id", body.request_id)
    .maybeSingle();
  if (fetchErr || !rr) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // テナント権限チェック
  const { data: isMember } = await supabase.rpc("is_tenant_member", {
    _tenant_id: rr.owner_id, _user_id: user.id,
  });
  if (!isMember) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // オーナー設定取得
  const { data: owner } = await supabase
    .from("profiles")
    .select("salon_name")
    .eq("id", rr.owner_id)
    .maybeSingle();
  const salonName = owner?.salon_name || "サロン";
  // location_id 解決
  let locationId: string | null = (rr as any).location_id || null;
  if (!locationId && rr.customer_id) {
    const { data: cu } = await supabase.from("customers").select("location_id").eq("id", rr.customer_id).maybeSingle();
    locationId = (cu as any)?.location_id || null;
  }
  const creds = await getLineCredentials(supabase, rr.owner_id, locationId);
  const accessToken = creds?.accessToken;

  // ============================================================
  // ACTION: approve（承認）
  // ============================================================
  if (body.action === "approve") {
    if (!body.confirmed_date || !body.confirmed_time) {
      return new Response(JSON.stringify({ error: "missing_date_time" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const menu = body.confirmed_menu || rr.desired_menu || "ご相談";
    const bookingMenus = Array.isArray(rr.desired_menu_items) && rr.desired_menu_items.length > 0
      ? rr.desired_menu_items
      : [menu];

    const menuGuard = await assertSalonboardSyncableMenu(supabase, rr.owner_id, locationId, bookingMenus);
    if (!menuGuard.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: menuGuard.error,
        message: menuGuard.message,
      }), {
        status: menuGuard.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // bookings に登録
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .insert({
        owner_id: rr.owner_id,
        location_id: locationId,
        customer_id: rr.customer_id,
        booking_date: body.confirmed_date,
        booking_time: body.confirmed_time,
        menu: menu.slice(0, 200),
        menus: bookingMenus,
        status: "confirmed",
        staff_id: body.confirmed_staff_id || null,
        notes: `LINEからの予約: ${rr.raw_message?.slice(0, 200) || ""}`,
        external_source: "line",
      })
      .select("id")
      .maybeSingle();

    if (bookingErr) {
      console.error("[reservation-approve] booking insert error:", bookingErr);
      return new Response(JSON.stringify({ error: "booking_create_failed", detail: bookingErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // サロンボード転記用テキスト生成
    const customerName = rr.display_name || "お客様";
    const sbText = `【サロンボード転記用】
お客様: ${customerName}様
日時: ${jpDate(body.confirmed_date)} ${body.confirmed_time}
メニュー: ${menu}
${body.confirmed_staff_id ? "担当: 指定あり" : ""}
※ LINEより自動取込`;

    // 仮予約を完了状態へ
    await supabase
      .from("reservation_requests")
      .update({
        status: "completed",
        confirmed_date: body.confirmed_date,
        confirmed_time: body.confirmed_time,
        confirmed_menu: menu,
        confirmed_staff_id: body.confirmed_staff_id || null,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        salonboard_transfer_text: sbText,
      })
      .eq("id", rr.id);

    // 🆕 AIログを「approved」で更新（手修正検出）
    try {
      const aiCands = (rr.ai_parsed as any)?.desiredDateCandidates?.[0];
      const corrected =
        (aiCands?.date && aiCands.date !== body.confirmed_date) ||
        (rr.desired_menu && menu !== rr.desired_menu);
      await supabase
        .from("reservation_ai_logs")
        .update({
          final_action: "approved",
          final_corrected: !!corrected,
          decided_at: new Date().toISOString(),
        })
        .eq("request_id", rr.id);
    } catch (e) {
      console.error("[reservation-approve] ai log update failed:", e);
    }

    // LINE自動返信
    if (accessToken && rr.line_user_id) {
      const extra = body.extra_message ? `\n\n${body.extra_message}` : "";
      const replyMsg = `${customerName}様

ご予約が確定いたしました🌸

📅 ${jpDate(body.confirmed_date)} ${body.confirmed_time}
💇 ${menu}

ご来店を心よりお待ちしております。${extra}

— ${salonName}`;
      const r = await sendLinePush(accessToken, rr.line_user_id, replyMsg);
      await supabase.from("line_message_log").insert({
        owner_id: rr.owner_id,
        location_id: locationId,
        customer_id: rr.customer_id,
        line_user_id: rr.line_user_id,
        job_type: "reservation_approved",
        message: replyMsg,
        status: r.ok ? "sent" : "failed",
        error: r.ok ? null : r.err,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      booking_id: booking?.id,
      salonboard_transfer_text: sbText,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ============================================================
  // ACTION: propose（別日時提案）
  // ============================================================
  if (body.action === "propose") {
    if (!body.proposal_message) {
      return new Response(JSON.stringify({ error: "missing_proposal" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const customerName = rr.display_name || "お客様";

    if (accessToken && rr.line_user_id) {
      const replyMsg = `${customerName}様

ご予約のご相談ありがとうございます🌸

${body.proposal_message}

ご都合いかがでしょうか？このトークでお返事をお待ちしております。

— ${salonName}`;
      const r = await sendLinePush(accessToken, rr.line_user_id, replyMsg);
      await supabase.from("line_message_log").insert({
        owner_id: rr.owner_id,
        location_id: locationId,
        customer_id: rr.customer_id,
        line_user_id: rr.line_user_id,
        job_type: "reservation_proposal",
        message: replyMsg,
        status: r.ok ? "sent" : "failed",
        error: r.ok ? null : r.err,
      });
    }

    await supabase
      .from("reservation_requests")
      .update({
        staff_memo: `${rr.staff_memo || ""}\n[${new Date().toISOString().slice(0,16)}] 提案送信: ${body.proposal_message.slice(0,200)}`,
      })
      .eq("id", rr.id);

    // 🆕 AIログを「proposed」で更新
    try {
      await supabase
        .from("reservation_ai_logs")
        .update({ final_action: "proposed", decided_at: new Date().toISOString() })
        .eq("request_id", rr.id);
    } catch {}

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ============================================================
  // ACTION: reject（却下）
  // ============================================================
  if (body.action === "reject") {
    const customerName = rr.display_name || "お客様";

    await supabase
      .from("reservation_requests")
      .update({
        status: "rejected",
        rejection_reason: body.rejection_reason || null,
        rejected_by: user.id,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", rr.id);

    // 🆕 AIログを「rejected」で更新
    try {
      await supabase
        .from("reservation_ai_logs")
        .update({
          final_action: "rejected",
          false_positive: !!body.rejection_reason && /違|別|間違|予約じゃ/.test(body.rejection_reason),
          decided_at: new Date().toISOString(),
        })
        .eq("request_id", rr.id);
    } catch {}

    if (accessToken && rr.line_user_id) {
      const replyMsg = body.reject_message || `${customerName}様

ご予約のお問い合わせありがとうございます。

申し訳ございません、ご希望の日時はあいにくお席が満席となっております。
別日でのご相談を承りますので、よろしければ改めてご希望をお送りください。

— ${salonName}`;
      const r = await sendLinePush(accessToken, rr.line_user_id, replyMsg);
      await supabase.from("line_message_log").insert({
        owner_id: rr.owner_id,
        location_id: locationId,
        customer_id: rr.customer_id,
        line_user_id: rr.line_user_id,
        job_type: "reservation_rejected",
        message: replyMsg,
        status: r.ok ? "sent" : "failed",
        error: r.ok ? null : r.err,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "invalid_action" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
