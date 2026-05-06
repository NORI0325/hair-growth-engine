// 取得済みの channel_menu_options から、ユーザー指示で
// menu_items を新規作成 or 既存と紐付け、menu_channel_mappings を作る
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

interface ImportItem {
  external_menu_id: string;
  setmenu_id?: string | null;
  menu_id?: string | null;
  menu_category_cd?: string | null;
  net_coupon_id?: string | null;
  source_type?: string | null;
  menu_name: string;
  rsv_term?: number | null;
  price?: number | null;
  action: "create" | "link" | "skip";
  target_menu_id?: string | null;
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
      if (it.action === "skip") { results.push({ external_menu_id: it.external_menu_id, status: "skipped" }); continue; }

      // category 単体（menu_id なし）は予約同期に使えないため取り込み不可
      if (it.source_type === "category" && !it.menu_id) {
        results.push({ external_menu_id: it.external_menu_id, status: "skipped", reason: "category_without_menu_id" });
        continue;
      }

      let menuId: string | null = it.target_menu_id ?? null;
      if (it.action === "create") {
        const { data: created, error: cErr } = await supabase.from("menu_items").insert({
          owner_id, location_id, name: it.menu_name,
          duration_minutes: it.rsv_term && it.rsv_term > 0 ? it.rsv_term : 60,
          price: it.price ?? 0, active: true,
        }).select("id").single();
        if (cErr) { results.push({ external_menu_id: it.external_menu_id, status: "error", error: cErr.message }); continue; }
        menuId = created.id;
      }
      if (!menuId) { results.push({ external_menu_id: it.external_menu_id, status: "error", error: "no_menu_id" }); continue; }

      const { error: mErr } = await supabase.from("menu_channel_mappings").upsert({
        owner_id, location_id, menu_id: menuId, channel: "salonboard",
        external_id: it.menu_id || it.external_menu_id,
        external_setmenu_id: it.setmenu_id || null,
        external_name: it.menu_name,
        menu_category_cd: it.menu_category_cd || null,
        net_coupon_id: it.net_coupon_id || null,
        rsv_term: it.rsv_term ?? null,
        enabled: true,
      }, { onConflict: "menu_id,channel" });
      if (mErr) { results.push({ external_menu_id: it.external_menu_id, status: "error", error: mErr.message }); continue; }
      results.push({ external_menu_id: it.external_menu_id, status: "ok", menu_id: menuId });
    }

    await supabase.rpc("recompute_channel_status", { _owner_id: owner_id, _location_id: location_id });

    return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
