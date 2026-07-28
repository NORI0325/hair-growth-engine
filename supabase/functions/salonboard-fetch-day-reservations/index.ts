// 指定日のサロンボード予約一覧をWorker経由で取得し、SalonBoost側 bookings と照合してプレビューを返す。
// DBには書き込まない（worker_request_logs のみ記録）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

interface ExternalItem {
  external_reservation_id: string | null;
  date: string;
  time: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  customerName: string | null;
  menu: string | null;
  stylistName: string | null;
  raw?: string;
  detail_url?: string | null;
  time_source?: "popup" | "detail" | "not_fetched_limit" | null;
  detail_fetch_skipped_reason?: string | null;
  detail_fetch_error?: string | null;
}

function fmtDate(d: string): string { return d.replaceAll("-", ""); }
function normalize(s: string | null | undefined): string {
  return (s || "").replace(/[\s　]/g, "").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const identity = await authenticateRequest(req, supabase);
    if (identity.kind !== "user") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const date: string | undefined = body.date;             // YYYY-MM-DD
    const location_id: string | null = typeof body.location_id === "string" ? body.location_id : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: "invalid_date" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!location_id) {
      return new Response(JSON.stringify({ error: "location_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: location } = await supabase.from("locations")
      .select("tenant_id")
      .eq("id", location_id)
      .maybeSingle();
    const ownerId = String(location?.tenant_id || "");
    if (!ownerId || !(await canAccessOwner(supabase, identity.userId, ownerId, ["owner", "manager", "super_admin"]))) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    let workerDiagnostics: Record<string, unknown> | null = null;
    let workerError: string | null = null;
    try {
      const wRes = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/salonboard/list-day-reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${workerKey}` },
        body: JSON.stringify({ store_id: ownerId, location_id, date: fmtDate(date) }),
      });
      const wJson = await wRes.json().catch(() => ({}));
      const latency = Date.now() - t0;
      try {
        await supabase.from("worker_request_logs").insert({
          owner_id: ownerId, location_id, channel: "salonboard",
          kind: "list_day_reservations",
          request_payload: { date },
          response_status: wRes.status, response_body: wJson, latency_ms: latency,
          success: !!wJson?.success,
          error_message: wJson?.success ? null : (wJson?.message || `HTTP ${wRes.status}`),
        });
      } catch (_) { /* ignore log failure */ }
      if (wJson?.success) {
        externalItems = Array.isArray(wJson.items) ? wJson.items : [];
        workerDiagnostics = typeof wJson.diagnostics === "object" && wJson.diagnostics !== null
          ? wJson.diagnostics as Record<string, unknown>
          : null;
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
      .eq("owner_id", ownerId)
      .eq("booking_date", date);
    if (location_id) q = q.eq("location_id", location_id);
    const { data: localBookings } = await q;
    const local = (localBookings as any[]) ?? [];

    // 分類
    type DiffKind = "time" | "customer" | "time_unknown";
    type Classified = ExternalItem & {
      classification: "matched" | "matched_with_diff" | "salonboard_only" | "conflict";
      matched_booking_id?: string | null;
      reason?: string;
      diffs?: DiffKind[];
      local_time?: string | null;
      local_customer_name?: string | null;
      local_menu?: string | null;
      salonboard_time?: string | null;
      salonboard_customer_name?: string | null;
    };

    const compareWithLocal = (it: ExternalItem, b: any): { diffs: DiffKind[]; local_time: string | null; local_customer_name: string | null; local_menu: string | null } => {
      const localTime = (b.booking_time || "").slice(0, 5) || null;
      const localName = b.customers?.full_name ?? null;
      const localMenu = b.menu ?? null;
      const diffs: DiffKind[] = [];
      // 時刻差分判定
      if (it.time && localTime) {
        if (it.time !== localTime) diffs.push("time");
      } else if (!it.time && localTime) {
        diffs.push("time_unknown");
      }
      // 顧客名差分判定（部分一致なら差分なし扱い）
      const wantName = normalize(it.customerName);
      const haveName = normalize(localName);
      if (wantName && haveName && !haveName.includes(wantName) && !wantName.includes(haveName)) {
        diffs.push("customer");
      }
      return { diffs, local_time: localTime, local_customer_name: localName, local_menu: localMenu };
    };

    const usedLocalIds = new Set<string>();
    const classified: Classified[] = externalItems.map((it) => {
      // 1) external_reservation_id 一致
      if (it.external_reservation_id) {
        const m = local.find((b) =>
          b.external_reservation_id && b.external_reservation_id === it.external_reservation_id);
        if (m) {
          usedLocalIds.add(m.id);
          const { diffs, local_time, local_customer_name, local_menu } = compareWithLocal(it, m);
          if (diffs.length === 0) {
            return {
              ...it, classification: "matched", matched_booking_id: m.id,
              reason: "external_reservation_id 一致",
              local_time, local_customer_name, local_menu,
              salonboard_time: it.time, salonboard_customer_name: it.customerName,
            };
          }
          return {
            ...it, classification: "matched_with_diff", matched_booking_id: m.id,
            reason: `ID一致だが内容差分あり: ${diffs.join(",")}`,
            diffs, local_time, local_customer_name, local_menu,
            salonboard_time: it.time, salonboard_customer_name: it.customerName,
          };
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
        const cand = candidates[0];
        usedLocalIds.add(cand.id);
        const { diffs, local_time, local_customer_name, local_menu } = compareWithLocal(it, cand);
        if (diffs.length === 0) {
          return {
            ...it, classification: "matched", matched_booking_id: cand.id,
            reason: "顧客名と時刻で1件一致",
            local_time, local_customer_name, local_menu,
            salonboard_time: it.time, salonboard_customer_name: it.customerName,
          };
        }
        return {
          ...it, classification: "matched_with_diff", matched_booking_id: cand.id,
          reason: `候補1件・内容差分あり: ${diffs.join(",")}`,
          diffs, local_time, local_customer_name, local_menu,
          salonboard_time: it.time, salonboard_customer_name: it.customerName,
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
      worker_diagnostics: workerDiagnostics,
      items: classified,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
