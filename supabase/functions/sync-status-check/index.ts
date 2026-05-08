// 予約ごとに「サロンボード側に同じ予約があるか」を読み取り専用で確認し、
// local_only / external_only / match / conflict / error を判定して
// sync_diff_snapshots に保存する。
// 重要: ここでは登録・更新・削除は一切行わない。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

interface BookingRow {
  id: string;
  owner_id: string;
  location_id: string | null;
  booking_date: string;
  booking_time: string;
  menu: string;
  total_duration_minutes: number | null;
  staff_id: string | null;
  customer_id: string;
  external_reservation_id: string | null;
  sync_status: string | null;
  customers?: { full_name: string | null; phone: string | null } | null;
  staff?: { name: string | null } | null;
}

function fmtDate(d: string): string {
  // "2026-05-08" -> "20260508"
  return d.replaceAll("-", "");
}
function fmtTime(t: string): string {
  // "15:30:00" -> "1530"
  return t.slice(0, 5).replace(":", "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const booking_id: string | undefined = body.booking_id;
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 予約取得（owner検証込み）
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select(`
        id, owner_id, location_id, booking_date, booking_time, menu,
        total_duration_minutes, staff_id, customer_id, external_reservation_id, sync_status,
        customers:customer_id(full_name, phone),
        staff:staff_id(name)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: "booking_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const b = booking as unknown as BookingRow;
    if (b.owner_id !== user.id) {
      // テナントメンバーのチェックを簡易的に: location_id があれば is_location_accessible で判定
      // 念のため owner と異なる場合は拒否（より厳密には RPC 化）
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // channel_integrations / mappings の状態
    // channel_integrations: location_id でも絞り込む（同一 owner で複数ロケーションあり得る）
    let ciQuery = supabase.from("channel_integrations")
      .select("enabled, sync_enabled, connection_status, location_id")
      .eq("owner_id", b.owner_id).eq("channel", "salonboard");
    if (b.location_id) ciQuery = ciQuery.eq("location_id", b.location_id);
    else ciQuery = ciQuery.is("location_id", null);

    const [{ data: ci }, { data: staffMap }, { data: menuMap }] = await Promise.all([
      ciQuery.maybeSingle(),
      b.staff_id
        ? supabase.from("staff_channel_mappings")
            .select("external_id, external_name, enabled, is_no_designation")
            .eq("owner_id", b.owner_id).eq("channel", "salonboard").eq("staff_id", b.staff_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("menu_channel_mappings").select("id, enabled, external_id, external_name")
        .eq("owner_id", b.owner_id).eq("channel", "salonboard").limit(1).maybeSingle(),
    ]);

    // SyncStatusDialog の表示互換のため、external_staff_id/external_staff_name にも揃える
    const staffMapNormalized = staffMap ? {
      external_staff_id: (staffMap as any).external_id ?? null,
      external_staff_name: (staffMap as any).external_name ?? null,
      enabled: (staffMap as any).enabled ?? null,
      is_no_designation: (staffMap as any).is_no_designation ?? false,
    } : null;

    const stylistId = b.staff_id ? (staffMapNormalized?.external_staff_id ?? null) : "0000000000";
    const stylistFallback = !b.staff_id;

    // 最新の sync_jobs
    const { data: lastJob } = await supabase.from("sync_jobs")
      .select("id, status, error_type, error_message, updated_at, job_type")
      .eq("reservation_id", b.id).eq("target_channel", "salonboard")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();

    const local_payload = {
      booking_id: b.id,
      date: b.booking_date,
      time: b.booking_time?.slice(0, 5),
      duration: b.total_duration_minutes,
      menu: b.menu,
      customer_name: b.customers?.full_name ?? null,
      staff_name: b.staff?.name ?? null,
      staff_id: b.staff_id,
      external_reservation_id: b.external_reservation_id,
      stylist_id_resolved: stylistId,
      stylist_fallback_no_designation: stylistFallback,
      channel_integration: ci ?? null,
      staff_mapping: staffMapNormalized,
      menu_mapping_exists: !!menuMap,
      last_job: lastJob ?? null,
    };

    // Worker 経由でサロンボード側を検索
    const workerUrl = Deno.env.get("EXTERNAL_WORKER_API_URL");
    const workerKey = Deno.env.get("EXTERNAL_WORKER_API_KEY");

    let externalItems: any[] = [];
    let workerError: string | null = null;
    let externalReachable = false;

    if (!workerUrl || !workerKey) {
      workerError = "worker_not_configured";
    } else if (!ci?.enabled) {
      workerError = "channel_disabled";
    } else {
      try {
        const t0 = Date.now();
        const wRes = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/salonboard/find-reservation`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${workerKey}` },
          body: JSON.stringify({
            store_id: b.owner_id,
            location_id: b.location_id,
            date: fmtDate(b.booking_date),
            time: fmtTime(b.booking_time),
            customer_name: b.customers?.full_name ?? undefined,
          }),
        });
        const wJson = await wRes.json().catch(() => ({}));
        const latency = Date.now() - t0;
        try {
          const { error: logErr } = await supabase.from("worker_request_logs").insert({
            owner_id: b.owner_id, location_id: b.location_id, channel: "salonboard",
            kind: "find_reservation",
            request_payload: { booking_id: b.id, date: b.booking_date, time: b.booking_time },
            response_status: wRes.status, response_body: wJson, latency_ms: latency,
            success: !!wJson?.success,
            error_message: wJson?.success ? null : (wJson?.message || `HTTP ${wRes.status}`),
          });
          if (logErr) console.error("worker_request_logs insert failed", logErr);
        } catch (logEx) {
          console.error("worker_request_logs insert threw", logEx);
        }
        if (wJson?.success) {
          externalReachable = true;
          externalItems = Array.isArray(wJson.items) ? wJson.items : [];
        } else {
          workerError = wJson?.error_type || wJson?.message || `HTTP ${wRes.status}`;
        }
      } catch (e) {
        workerError = e instanceof Error ? e.message : String(e);
      }
    }

    // 判定ロジック
    let result: "local_only" | "external_only" | "match" | "conflict" | "error" = "error";
    let reason = "";

    if (workerError) {
      result = "error";
      reason = `external check failed: ${workerError}`;
    } else if (!externalReachable) {
      result = "error";
      reason = "external not reachable";
    } else {
      // external_reservation_id が紐付いていれば、それで照合
      const matchedById = b.external_reservation_id
        ? externalItems.find((it) => it.external_reservation_id === b.external_reservation_id)
        : null;

      // 顧客名 + 時刻でマッチ候補を探す
      const customerName = (b.customers?.full_name || "").trim();
      const wantTime = b.booking_time?.slice(0, 5) ?? "";
      const candidates = externalItems.filter((it) => {
        const tOk = !it.time || it.time === wantTime;
        const nOk = !customerName || (it.customerName || "").includes(customerName)
          || customerName.includes(it.customerName || "");
        return tOk && nOk;
      });

      if (matchedById) {
        // 内容一致チェック
        const diffs: string[] = [];
        if (matchedById.time && matchedById.time !== wantTime) diffs.push("time");
        if (customerName && matchedById.customerName && !matchedById.customerName.includes(customerName)) diffs.push("customer");
        if (diffs.length === 0) {
          result = "match";
          reason = "matched by external_reservation_id";
        } else {
          result = "conflict";
          reason = `matched by id but differs: ${diffs.join(",")}`;
        }
      } else if (candidates.length === 0) {
        result = "local_only";
        reason = "no candidate found on salonboard";
      } else if (candidates.length === 1 && !b.external_reservation_id) {
        // 同条件で1件 → 多分同じ予約だが ID 紐付けされていない
        result = "conflict";
        reason = "candidate found but external_reservation_id not linked";
      } else {
        result = "conflict";
        reason = `${candidates.length} candidates found`;
      }
    }

    const external_payload = {
      reachable: externalReachable,
      items: externalItems,
      error: workerError,
    };

    // sync_diff_snapshots に保存
    const { data: snap } = await supabase.from("sync_diff_snapshots").insert({
      owner_id: b.owner_id,
      location_id: b.location_id,
      booking_id: b.id,
      channel: "salonboard",
      result,
      reason,
      local_payload,
      external_payload,
      diff: null,
      external_reservation_id: b.external_reservation_id,
      checked_by: user.id,
    }).select("id, checked_at").maybeSingle();

    // bookings.sync_status を更新（結果に応じて needs_review / external_missing 等にマッピング）
    const newStatus = result === "match" ? "synced"
      : result === "local_only" ? "external_missing"
      : result === "conflict" ? "needs_review"
      : null;
    if (newStatus) {
      await supabase.from("bookings").update({ sync_status: newStatus }).eq("id", b.id);
    }

    return new Response(JSON.stringify({
      success: true,
      result,
      reason,
      snapshot_id: snap?.id ?? null,
      checked_at: snap?.checked_at ?? new Date().toISOString(),
      local: local_payload,
      external: external_payload,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
