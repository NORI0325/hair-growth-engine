// 取得済みの channel_staff_options から、ユーザー指示で
// staff を新規作成 or 既存と紐付け、staff_channel_mappings を作る
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

interface ImportItem {
  external_staff_id: string;
  display_name: string;
  is_no_designation?: boolean;
  action: "create" | "link" | "skip";
  target_staff_id?: string | null; // link 時必須
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const owner_id: string = body.owner_id || user.id;
    const location_id: string | null = body.location_id ?? null;
    const items: ImportItem[] = Array.isArray(body.items) ? body.items : [];

    const results: any[] = [];
    for (const it of items) {
      if (it.action === "skip") { results.push({ external_staff_id: it.external_staff_id, status: "skipped" }); continue; }

      let staffId: string | null = it.target_staff_id ?? null;
      if (it.action === "create") {
        const { data: created, error: cErr } = await supabase.from("staff").insert({
          owner_id, location_id, name: it.display_name, active: true, bookable: !it.is_no_designation,
        }).select("id").single();
        if (cErr) { results.push({ external_staff_id: it.external_staff_id, status: "error", error: cErr.message }); continue; }
        staffId = created.id;
      }
      if (!staffId) { results.push({ external_staff_id: it.external_staff_id, status: "error", error: "no_staff_id" }); continue; }

      const { error: mErr } = await supabase.from("staff_channel_mappings").upsert({
        owner_id, location_id, staff_id: staffId, channel: "salonboard",
        external_id: it.external_staff_id,
        external_name: it.display_name,
        is_no_designation: !!it.is_no_designation,
        enabled: true,
      }, { onConflict: "staff_id,channel" });
      if (mErr) { results.push({ external_staff_id: it.external_staff_id, status: "error", error: mErr.message }); continue; }
      results.push({ external_staff_id: it.external_staff_id, status: "ok", staff_id: staffId });
    }

    await supabase.rpc("recompute_channel_status", { _owner_id: owner_id, _location_id: location_id });

    return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
