// 第3段階: 「サロンボードへ再送信」
// 必ず直前に find-reservation で照合し、外部に存在しない場合のみ create_reservation ジョブを発行する。
// 二重予約事故を防止するため、自動再送信は禁止。管理者による手動操作を前提。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

function fmtDate(d: string) { return d.replaceAll("-", ""); }
function fmtTime(t: string) { return t.slice(0, 5).replace(":", ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const booking_id: string | undefined = body.booking_id;
    if (!booking_id) return new Response(JSON.stringify({ error: "booking_id_required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: booking } = await supabase.from("bookings").select(`
      id, owner_id, location_id, booking_date, booking_time, menu, total_duration_minutes,
      staff_id, customer_id, external_reservation_id, sync_status,
      customers:customer_id(full_name, phone, email),
      staff:staff_id(name)
    `).eq("id", booking_id).maybeSingle();
    if (!booking) return new Response(JSON.stringify({ error: "booking_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const b: any = booking;
    if (b.owner_id !== user.id) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!b.location_id) return new Response(JSON.stringify({ error: "location_required", message: "店舗未割当の予約は再送信できません" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // channel_integration を確認
    const { data: ci } = await supabase.from("channel_integrations")
      .select("enabled, sync_enabled, connection_status, location_id")
      .eq("owner_id", b.owner_id).eq("channel", "salonboard").eq("location_id", b.location_id).maybeSingle();
    if (!ci?.enabled || !ci?.sync_enabled || ci?.connection_status !== "live") {
      return new Response(JSON.stringify({ error: "channel_not_ready", message: "サロンボード接続が有効ではありません" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const workerUrl = Deno.env.get("EXTERNAL_WORKER_API_URL");
    const workerKey = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    if (!workerUrl || !workerKey) {
      return new Response(JSON.stringify({ error: "worker_not_configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 直前照合: 必ず find-reservation を実行して外部に同じ予約が無いことを確認
    const customerName = b.customers?.full_name ?? null;
    const wRes = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/salonboard/find-reservation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${workerKey}` },
      body: JSON.stringify({
        store_id: b.owner_id,
        location_id: b.location_id,
        date: fmtDate(b.booking_date),
        time: fmtTime(b.booking_time),
        customer_name: customerName,
      }),
    });
    const wJson: any = await wRes.json().catch(() => ({}));
    if (!wJson?.success) {
      return new Response(JSON.stringify({ error: "external_check_failed", message: wJson?.message || `HTTP ${wRes.status}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const items: any[] = Array.isArray(wJson.items) ? wJson.items : [];
    const wantTime = b.booking_time?.slice(0, 5);
    const matchedById = b.external_reservation_id ? items.find((it) => it.external_reservation_id === b.external_reservation_id) : null;
    const candidates = items.filter((it) => {
      const tOk = !it.time || it.time === wantTime;
      const nOk = !customerName || (it.customerName || "").includes(customerName) || customerName.includes(it.customerName || "");
      return tOk && nOk;
    });

    // 既存の external_reservation_id 一致 → match → 何もしない
    if (matchedById) {
      await supabase.from("bookings").update({ sync_status: "synced" }).eq("id", b.id);
      return new Response(JSON.stringify({
        action: "skipped",
        reason: "already_exists_on_salonboard",
        message: "サロンボード側に既に該当予約が存在します（external_reservation_id 一致）。再送信は行いません。",
        external_reservation_id: matchedById.external_reservation_id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // 候補が見つかった場合 → conflict として扱い、再送信は中止
    if (candidates.length > 0) {
      await supabase.from("bookings").update({ sync_status: "conflict", needs_manual_review: true }).eq("id", b.id);
      await supabase.from("sync_diff_snapshots").insert({
        owner_id: b.owner_id, location_id: b.location_id, booking_id: b.id, channel: "salonboard",
        result: "conflict", reason: "candidate found on resend pre-check; refused to send to avoid duplicate",
        local_payload: { booking_id: b.id, date: b.booking_date, time: wantTime, customer_name: customerName },
        external_payload: { reachable: true, items, error: null },
        external_reservation_id: b.external_reservation_id, checked_by: user.id,
      });
      return new Response(JSON.stringify({
        action: "refused",
        reason: "candidate_on_external",
        message: "サロンボード側に候補が見つかったため、二重予約防止のため再送信を中止しました。差分を確認してください。",
        candidates,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 既存 pending ジョブがあれば再利用 / 無ければ新規作成
    const { data: pending } = await supabase.from("sync_jobs")
      .select("id").eq("reservation_id", b.id).eq("target_channel", "salonboard")
      .eq("job_type", "create_reservation").in("status", ["pending", "processing"]).limit(1).maybeSingle();

    // staff/menu mapping (※ staff_channel_mappings / menu_channel_mappings の実カラムは external_id / external_name)
    console.log("[resend] booking", { booking_id: b.id, location_id: b.location_id, staff_id: b.staff_id, menu: b.menu });
    console.log("[resend] channel_integration", { enabled: ci?.enabled, sync_enabled: ci?.sync_enabled, status: ci?.connection_status });

    let extStaffId: string | null = null, extStaffName: string | null = null;
    const staffSelected = !!b.staff_id;
    if (staffSelected) {
      const { data: scm } = await supabase.from("staff_channel_mappings")
        .select("external_id, external_name, enabled, is_no_designation")
        .eq("staff_id", b.staff_id).eq("channel", "salonboard").maybeSingle();
      extStaffId = scm?.external_id ?? null;
      extStaffName = scm?.external_name ?? null;
      console.log("[resend] staff_mapping", scm ? { found: true, external_id: extStaffId, external_name: extStaffName, enabled: scm.enabled } : { found: false, staff_id: b.staff_id });
      if (!extStaffId) {
        return new Response(JSON.stringify({
          error: "mapping_not_found",
          message: `mapping_not_found: staff_channel_mappings for staff_id=${b.staff_id} (担当スタッフのサロンボード連携が未設定です)`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      console.log("[resend] staff not selected → フリー fallback");
    }

    let extMenuId: string | null = null;
    let extMenuName: string | null = null;
    let menuItemId: string | null = null;
    {
      const { data: menuRow } = await supabase.from("menu_items")
        .select("id").eq("owner_id", b.owner_id).eq("name", b.menu).maybeSingle();
      menuItemId = menuRow?.id ?? null;
      if (menuItemId) {
        const { data: mcm } = await supabase.from("menu_channel_mappings")
          .select("external_id, external_name")
          .eq("menu_id", menuItemId).eq("channel", "salonboard").maybeSingle();
        extMenuId = mcm?.external_id ?? null;
        extMenuName = mcm?.external_name ?? null;
        console.log("[resend] menu_mapping", mcm ? { found: true, external_id: extMenuId, external_name: extMenuName } : { found: false, menu_item_id: menuItemId });
      } else {
        console.log("[resend] menu_item not found", { owner_id: b.owner_id, menu: b.menu });
      }
      if (!extMenuId) {
        return new Response(JSON.stringify({
          error: "mapping_not_found",
          message: `mapping_not_found: menu_channel_mappings for menu_item_id=${menuItemId ?? "null"} (menu="${b.menu}") — サロンボードのメニューIDが未紐付けです`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    console.log("[resend] find_reservation result count:", items.length);
    const startISO = new Date(`${b.booking_date}T${b.booking_time?.slice(0, 5)}:00+09:00`).toISOString();
    const endISO = new Date(new Date(startISO).getTime() + (b.total_duration_minutes || 60) * 60_000).toISOString();
    const payload = {
      customer_name: b.customers?.full_name,
      customer_phone: b.customers?.phone,
      customer_email: b.customers?.email,
      start_time: startISO, end_time: endISO,
      staff_name: b.staff?.name ?? null,
      external_staff_name: extStaffName, external_staff_id: extStaffId,
      menu_name: b.menu, external_menu_id: extMenuId, external_menu_name: extMenuName,
      source_channel: "manual_resend",
    };

    let jobId: string;
    if (pending?.id) {
      await supabase.from("sync_jobs").update({
        status: "pending", error_type: null, error_message: null, request_payload: payload,
      }).eq("id", pending.id);
      jobId = pending.id;
    } else {
      const { data: ins, error: insErr } = await supabase.from("sync_jobs").insert({
        owner_id: b.owner_id, location_id: b.location_id, reservation_id: b.id,
        target_channel: "salonboard", job_type: "create_reservation", status: "pending",
        request_payload: payload,
      }).select("id").maybeSingle();
      if (insErr) return new Response(JSON.stringify({ error: "job_insert_failed", message: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      jobId = ins!.id;
    }
    console.log("[resend] sync_job upserted", { sync_job_id: jobId, external_staff_id: extStaffId, external_menu_id: extMenuId });

    await supabase.from("bookings").update({ sync_status: "pending", needs_manual_review: false, last_sync_error: null }).eq("id", b.id);
    // dispatch (fire-and-forget)
    supabase.functions.invoke("sync-job-dispatch", { body: { reservation_id: b.id, job_ids: [jobId] } }).catch(() => {});

    return new Response(JSON.stringify({
      action: "enqueued",
      message: "サロンボードへの再送信を予約しました。処理状況は同期状態確認で再度ご確認ください。",
      job_id: jobId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
