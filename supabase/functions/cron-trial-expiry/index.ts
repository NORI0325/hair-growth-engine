import { createClient } from "npm:@supabase/supabase-js@2";
import { requireInternalRequest } from "../_shared/request-auth.ts";

Deno.serve(async (req) => {
  const auth = await requireInternalRequest(req);
  if (auth instanceof Response) return auth;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // トライアル期限切れ + クレカ未登録 → locked
  const { data: expired } = await supabase
    .from("subscriptions")
    .select("owner_id")
    .eq("status", "trialing")
    .is("stripe_customer_id", null)
    .lt("trial_ends_at", new Date().toISOString());

  const ids = (expired as any[] ?? []).map((s) => s.owner_id);
  if (ids.length === 0) return new Response(JSON.stringify({ ok: true, locked: 0 }));

  await supabase.from("subscriptions")
    .update({ status: "locked", updated_at: new Date().toISOString() })
    .in("owner_id", ids);

  return new Response(JSON.stringify({ ok: true, locked: ids.length, owners: ids }), {
    headers: { "Content-Type": "application/json" },
  });
});
