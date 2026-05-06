// 認証ユーザーがWorker経由でサロンボードからスタッフ一覧を取得し、
// channel_staff_options に保存する。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();
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
    const owner_id: string = body.owner_id || user.id;
    const location_id: string | null = body.location_id ?? null;

    const workerUrl = Deno.env.get("EXTERNAL_WORKER_API_URL");
    const workerKey = Deno.env.get("EXTERNAL_WORKER_API_KEY");
    if (!workerUrl || !workerKey) {
      return new Response(JSON.stringify({ error: "worker_not_configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/salonboard/fetch-staff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${workerKey}` },
      body: JSON.stringify({ store_id: owner_id, location_id }),
    });
    const httpStatus = res.status;
    const json = await res.json().catch(() => ({ success: false, error_type: "invalid_json" }));
    const latency = Date.now() - t0;

    await supabase.from("worker_request_logs").insert({
      owner_id, location_id, channel: "salonboard", kind: "fetch_staff",
      request_payload: { store_id: owner_id, location_id },
      response_status: httpStatus,
      response_body: json,
      latency_ms: latency,
      success: !!json?.success,
      error_message: json?.success ? null : (json?.message || `HTTP ${httpStatus}`),
    });

    if (!json?.success) {
      return new Response(JSON.stringify({ success: false, error: json?.error_type || "fetch_failed", message: json?.message }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const staff: any[] = Array.isArray(json.staff) ? json.staff : [];
    const fetchedAt = new Date().toISOString();
    const rows = staff.map((s) => ({
      owner_id, location_id, channel: "salonboard",
      external_staff_id: String(s.stylist_id),
      display_name: String(s.display_name || s.stylist_id),
      is_no_designation: !!s.is_no_designation,
      active: s.active !== false,
      raw_payload: s,
      fetched_at: fetchedAt,
    }));

    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from("channel_staff_options")
        .upsert(rows, { onConflict: "owner_id,location_id,channel,external_staff_id" });
      if (upErr) {
        // location_id null 時は coalesce key だが、unique index は coalesce なので fallback で個別 upsert
        for (const r of rows) {
          // delete + insert で再試行
          let q = supabase.from("channel_staff_options").delete()
            .eq("owner_id", r.owner_id).eq("channel", r.channel).eq("external_staff_id", r.external_staff_id);
          q = r.location_id ? q.eq("location_id", r.location_id) : q.is("location_id", null);
          await q;
          await supabase.from("channel_staff_options").insert(r);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, count: rows.length, staff: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
