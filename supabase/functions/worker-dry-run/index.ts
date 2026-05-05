import { corsHeaders } from "../_shared/cors.ts";

// Lovable→VM Worker dry-run 疎通テスト
// サロンボードに一切書き込みません
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("EXTERNAL_WORKER_API_URL");
  const key = Deno.env.get("EXTERNAL_WORKER_API_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ ok: false, error: "missing_env" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = {
    job_id: `dryrun-${crypto.randomUUID()}`,
    target_channel: "salonboard",
    job_type: "create",
    reservation: {
      dry_run: true,
      note: "Lovable→VM dry-run test",
    },
  };

  try {
    const t0 = Date.now();
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/sync-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return new Response(JSON.stringify({
      ok: true,
      status: res.status,
      latency_ms: Date.now() - t0,
      sent: payload,
      body,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
