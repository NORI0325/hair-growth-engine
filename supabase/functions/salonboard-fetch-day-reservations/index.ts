// 指定日のサロンボード予約一覧をWorker経由で取得し、SalonBoost側 bookings と照合してプレビューを返す。
// DBには書き込まない（worker_request_logs のみ記録）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

interface ExternalItem {
  external_reservation_id: string | null;
  date: string;
  time: string | null;
  customerName: string | null;
  menu: string | null;
  stylistName: string | null;
  raw?: string;
}

function fmtDate(d: string): string { return d.replaceAll("-", ""); }
function normalize(s: string | null | undefined): string {
  return (s || "").replace(/[\s　]/g, "").toLowerCase();
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
    const date: string | undefined = body.date;             // YYYY-MM-DD
    const location_id: string | null = body.location_id ?? null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: "invalid_date" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const workerUrl = Deno.env.get("EXTERNAL_WORKER_API_URL");
    const workerKey = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    if (!workerUrl || !workerKey) {
      return new Response(JSON.stringify({ error: "worker_not_configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t0 = Date.now();
    let externalItems: ExternalItem[] = [];
    let workerError: string | null = null;
    try {
      const wRes = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/salonboard/list-day-reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${workerKey}` },
        body: JSON.stringify({ store_id: user.id, location_id, date: fmtDate(date) }),
      });
      const wJson = await wRes.json().catch(() => ({}));
      const latency = Date.now() - t0;
      try {
        await supabase.from("worker_request_logs").insert({
          owner_id: user.id, location_id, channel: "salonboard",
          kind: "list_day_reservations",
          request_payload: { date },
          response_status: wRes.status, response_body: wJson, latency_ms: latency,
          success: !!wJson?.success,
          error_message: wJson?.success ? null : (wJson?.message || `HTTP ${wRes.status}`),
        });
      } catch (_) { /* ignore log failure */ }
      if (wJson?.success) {
        externalItems = Array.isArray(wJson.items) ? wJson.items : [];
      } else {
        workerError = wJson?.error_type || wJson?.message || `HTTP ${wRes.status}`;
      }
    } catch (e) {
      workerError = e instanceof Error ? e.message : String(e);
    }

    if (workerError) {
      return new Response(JSON.stringify({ error: "worker_failed", message: workerError }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SalonBoost 側 bookings を当日分まとめて取得
    let q = supabase.from("bookings")
      .select(`id, booking_date, booking_time, menu, status, external_reservation_id, external_source, customer_id,
               customers:customer_id(full_name)`)
      .eq("owner_id", user.id)
      .eq("booking_date", date);
    if (location_id) q = q.eq("location_id", location_id);
    const { data: localBookings } = await q;
    const local = (localBookings as any[]) ?? [];

    // 分類
    type Classified = ExternalItem & {
      classification: "matched" | "salonboard_only" | "conflict";
      matched_booking_id?: string | null;
      reason?: string;
    };
    const usedLocalIds = new Set<string>();
    const classified: Classified[] = externalItems.map((it) => {
      // 1) external_reservation_id 一致
      if (it.external_reservation_id) {
        const m = local.find((b) =>
          b.external_reservation_id && b.external_reservation_id === it.external_reservation_id);
        if (m) {
          usedLocalIds.add(m.id);
          return { ...it, classification: "matched", matched_booking_id: m.id, reason: "external_reservation_id 一致" };
        }
      }
      // 2) 顧客名 + 時刻 一致
      const wantTime = it.time || "";
      const wantName = normalize(it.customerName);
      const candidates = local.filter((b) => {
        const t = (b.booking_time || "").slice(0, 5);
        const n = normalize(b.customers?.full_name);
        const tOk = !wantTime || !t || t === wantTime;
        const nOk = !wantName || !n || n.includes(wantName) || wantName.includes(n);
        return tOk && nOk && !usedLocalIds.has(b.id);
      });
      if (candidates.length === 1) {
        usedLocalIds.add(candidates[0].id);
        return {
          ...it,
          classification: "matched",
          matched_booking_id: candidates[0].id,
          reason: "顧客名と時刻で1件一致",
        };
      }
      if (candidates.length > 1) {
        return { ...it, classification: "conflict", reason: `候補${candidates.length}件` };
      }
      return { ...it, classification: "salonboard_only", reason: "SalonBoost側に該当なし" };
    });

    return new Response(JSON.stringify({
      success: true,
      date,
      location_id,
      total_external: externalItems.length,
      total_local: local.length,
      items: classified,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
