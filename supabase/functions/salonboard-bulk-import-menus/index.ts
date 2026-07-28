// 取得済みの channel_menu_options から、ユーザー指示で
// menu_items を新規作成 or 既存と紐付け、menu_channel_mappings を作る
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

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
  active?: boolean | null;
  action: "create" | "link" | "skip";
  target_menu_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const identity = await authenticateRequest(req, supabase);
    if (identity.kind !== "user") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const owner_id = String(body.owner_id || "");
    const location_id = body.location_id ? String(body.location_id) : "";
    const items: ImportItem[] = Array.isArray(body.items) ? body.items : [];
    if (!owner_id || !location_id || !await canAccessOwner(supabase, identity.userId, owner_id, ["owner", "manager", "super_admin"])) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (items.length > 500) {
      return new Response(JSON.stringify({ error: "too_many_items", max: 500 }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: location } = await supabase.from("locations").select("id")
      .eq("id", location_id).eq("tenant_id", owner_id).maybeSingle();
    if (!location) return new Response(JSON.stringify({ error: "invalid_location" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const results: any[] = [];
    for (const it of items) {
      if (it.action === "skip") { results.push({ external_menu_id: it.external_menu_id, status: "skipped" }); continue; }

      const setmenuId = String(it.setmenu_id || "").trim();
      if (it.source_type !== "setmenu" || !/^SN[0-9]+$/.test(setmenuId) || !it.rsv_term || it.rsv_term <= 0) {
        results.push({ external_menu_id: it.external_menu_id, status: "skipped", reason: "not_syncable_setmenu" });
        continue;
      }

      let menuId: string | null = it.target_menu_id ?? null;
      const durationMinutes = it.rsv_term;
      const hasPrice = typeof it.price === "number" && Number.isFinite(it.price);
      const menuPrice = hasPrice ? it.price! : 0;
      const active = it.active !== false;
      if (it.action === "create") {
        const { data: created, error: cErr } = await supabase.from("menu_items").insert({
          owner_id, location_id, name: it.menu_name,
          duration_minutes: durationMinutes,
          price: menuPrice, active,
        }).select("id").single();
        if (cErr) { results.push({ external_menu_id: it.external_menu_id, status: "error", error: cErr.message }); continue; }
        menuId = created.id;
      }
      if (!menuId) { results.push({ external_menu_id: it.external_menu_id, status: "error", error: "no_menu_id" }); continue; }

      if (it.action === "link") {
        const { data: target } = await supabase.from("menu_items").select("id")
          .eq("id", menuId).eq("owner_id", owner_id).eq("location_id", location_id).maybeSingle();
        if (!target) { results.push({ external_menu_id: it.external_menu_id, status: "error", error: "invalid_target_menu" }); continue; }
        const menuPatch: Record<string, unknown> = {
          name: it.menu_name,
          duration_minutes: durationMinutes,
          active,
        };
        if (hasPrice) menuPatch.price = menuPrice;
        const { error: updateErr } = await supabase.from("menu_items").update(menuPatch)
          .eq("id", menuId).eq("owner_id", owner_id).eq("location_id", location_id);
        if (updateErr) { results.push({ external_menu_id: it.external_menu_id, status: "error", error: updateErr.message }); continue; }
      }

      const { error: mErr } = await supabase.from("menu_channel_mappings").upsert({
        owner_id, location_id, menu_id: menuId, channel: "salonboard",
        external_id: it.menu_id || it.external_menu_id,
        external_setmenu_id: it.setmenu_id || null,
        external_name: it.menu_name,
        menu_category_cd: it.menu_category_cd || null,
        net_coupon_id: it.net_coupon_id || null,
        rsv_term: it.rsv_term ?? null,
        enabled: active,
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
