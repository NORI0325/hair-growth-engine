// 90〜120日来店なしの顧客に「復活クーポン」ジョブを作成。
// cron で日次起動する想定。手動実行も可能。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateRequest, canAccessOwner, withCors } from "../_shared/request-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const identity = await authenticateRequest(req, supabase);
    if (identity.kind === "anonymous") {
      return withCors(new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      }), corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    let ownerId = typeof body?.owner_id === "string" ? body.owner_id : null;

    if (identity.kind === "user") {
      if (!ownerId || !await canAccessOwner(
        supabase,
        identity.userId,
        ownerId,
        ["manager", "owner", "super_admin"],
      )) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data, error } = ownerId
      ? await supabase.rpc("create_reactivation_jobs_for_owner", { _owner_id: ownerId })
      : await supabase.rpc("create_reactivation_jobs");
    if (error) throw error;

    return new Response(JSON.stringify({ created: data ?? 0, owner_id: ownerId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-reactivation-jobs error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
