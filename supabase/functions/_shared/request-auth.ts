import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type RequestIdentity =
  | { kind: "internal"; userId: null }
  | { kind: "user"; userId: string }
  | { kind: "anonymous"; userId: null };

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearerToken(req: Request): string {
  const value = req.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

/**
 * Authenticates a request after the platform gateway. This is required for
 * verify_jwt=false functions because an apikey header alone is not caller
 * authorization.
 */
export async function authenticateRequest(
  req: Request,
  serviceClient?: SupabaseClient,
): Promise<RequestIdentity> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const configuredInternalSecret = Deno.env.get("EDGE_INTERNAL_SECRET") ?? "";
  const token = bearerToken(req);
  const apiKey = req.headers.get("apikey") ?? "";
  const internalSecret = req.headers.get("x-internal-secret") ?? "";

  if (
    (serviceRoleKey && (timingSafeEqual(token, serviceRoleKey) || timingSafeEqual(apiKey, serviceRoleKey)))
    || (configuredInternalSecret && timingSafeEqual(internalSecret, configuredInternalSecret))
  ) {
    return { kind: "internal", userId: null };
  }

  if (!token) return { kind: "anonymous", userId: null };

  const supabase = serviceClient ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { kind: "anonymous", userId: null };
  return { kind: "user", userId: data.user.id };
}

export function unauthorizedResponse(message = "Unauthorized"): Response {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized", message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function requireInternalRequest(
  req: Request,
  serviceClient?: SupabaseClient,
): Promise<RequestIdentity | Response> {
  const identity = await authenticateRequest(req, serviceClient);
  return identity.kind === "internal" ? identity : unauthorizedResponse();
}

export async function canAccessOwner(
  supabase: SupabaseClient,
  userId: string,
  ownerId: string,
  minimumRoles?: string[],
): Promise<boolean> {
  const { data } = await supabase
    .from("tenant_members")
    .select("role, accepted_at")
    .eq("tenant_id", ownerId)
    .eq("user_id", userId)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (data && (!minimumRoles?.length || minimumRoles.includes(String(data.role)))) return true;

  // A platform super administrator is not required to have a synthetic row in
  // every tenant. Keep this explicit and only honor it when the caller permits
  // the super_admin role.
  if (minimumRoles?.length && !minimumRoles.includes("super_admin")) return false;
  const { data: platformRole } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  return Boolean(platformRole);
}

export function withCors(response: Response, corsHeaders: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
