import { corsHeaders } from "../_shared/cors.ts";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ configured: false, liffId: null, error: "method_not_allowed" }, 405);
  }

  const liffId = (Deno.env.get("LINE_LIFF_ID") || "").trim();

  return json({
    configured: Boolean(liffId),
    liffId: liffId || null,
  });
});
