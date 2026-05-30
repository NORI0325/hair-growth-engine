import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_PUBLIC_APP_ORIGIN = "https://saronboost.com";

const normalizeOrigin = (value: string | null | undefined) => {
  const raw = (value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

const getPublicAppOrigin = () =>
  normalizeOrigin(
    Deno.env.get("PUBLIC_APP_ORIGIN") ||
      Deno.env.get("APP_PUBLIC_ORIGIN") ||
      DEFAULT_PUBLIC_APP_ORIGIN,
  ) || DEFAULT_PUBLIC_APP_ORIGIN;

const isEnabled = (value: string | null | undefined) =>
  ["1", "true", "yes", "on"].includes((value || "").trim().toLowerCase());

const getRequestToken = async (req: Request) => {
  if (req.method === "GET") {
    return (new URL(req.url).searchParams.get("token") || "").trim().toUpperCase();
  }

  try {
    const body = await req.json();
    return typeof body?.token === "string" ? body.token.trim().toUpperCase() : "";
  } catch {
    return "";
  }
};

const getLineAddFriendUrl = async (token: string) => {
  if (!/^[A-Z0-9]{8}$/.test(token)) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tokenRow } = await supabase
    .from("customer_line_link_tokens")
    .select("owner_id, customer_id")
    .eq("token", token)
    .maybeSingle();

  if (!tokenRow) return null;

  const { data: customer } = await supabase
    .from("customers")
    .select("location_id")
    .eq("id", tokenRow.customer_id)
    .eq("owner_id", tokenRow.owner_id)
    .maybeSingle();

  if (customer?.location_id) {
    const { data: location } = await supabase
      .from("locations")
      .select("line_add_friend_url")
      .eq("id", customer.location_id)
      .eq("owner_id", tokenRow.owner_id)
      .maybeSingle();

    if (location?.line_add_friend_url) return location.line_add_friend_url;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("line_add_friend_url")
    .eq("id", tokenRow.owner_id)
    .maybeSingle();

  return profile?.line_add_friend_url || null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ configured: false, liffId: null, error: "method_not_allowed" }, 405);
  }

  const liffId = isEnabled(Deno.env.get("LINE_LIFF_ENABLED"))
    ? (Deno.env.get("LINE_LIFF_ID") || "").trim()
    : "";
  const publicAppOrigin = getPublicAppOrigin();
  const token = await getRequestToken(req);
  const lineAddFriendUrl = await getLineAddFriendUrl(token);

  return json({
    configured: Boolean(liffId),
    liffId: liffId || null,
    publicAppOrigin,
    lineAddFriendUrl,
  });
});
