// 第3段階: 競合(conflict)解消 — 管理者が選んだ方向に従って処理する。
// A: salonboost_to_salonboard  → サロンボード側を更新するための update_reservation ジョブを発行
// B: salonboard_to_salonboost  → SalonBoost 側 (bookings) を スナップショットの external_payload に基づき更新
// C: skip → 何もせず needs_manual_review を解除
// 自動上書きはしない。必ず管理者の明示的な選択に基づいて動く。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { booking_id, decision, snapshot_id } = await req.json().catch(() => ({}));
    if (!booking_id || !["A", "B", "C"].includes(decision)) {
      return new Response(JSON.stringify({ error: "invalid_params", message: "booking_id と decision (A/B/C) は必須" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: b } = await supabase.from("bookings").select(`
      id, owner_id, location_id, booking_date, booking_time, menu, total_duration_minutes,
      staff_id, customer_id, external_reservation_id,
      customers:customer_id(full_name, phone, email),
      staff:staff_id(name)
    `).eq("id", booking_id).maybeSingle();
    if (!b) return new Response(JSON.stringify({ error: "booking_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if ((b as any).owner_id !== user.id) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (decision === "C") {
      await supabase.from("bookings").update({ needs_manual_review: false, sync_status: "not_required" }).eq("id", booking_id);
      return new Response(JSON.stringify({ action: "skipped", message: "差分は据え置きで「対応不要」にしました。" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (decision === "A") {
      // SalonBoost の内容でサロンボードを更新
      if (!(b as any).external_reservation_id) {
        return new Response(JSON.stringify({ error: "no_external_id", message: "external_reservation_id が無いため更新できません。先に「取り込み」または「再送信」を行ってください。" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const startISO = new Date(`${(b as any).booking_date}T${(b as any).booking_time?.slice(0, 5)}:00+09:00`).toISOString();
      const endISO = new Date(new Date(startISO).getTime() + ((b as any).total_duration_minutes || 60) * 60_000).toISOString();
      const { data: ins, error: insErr } = await supabase.from("sync_jobs").insert({
        owner_id: (b as any).owner_id, location_id: (b as any).location_id, reservation_id: booking_id,
        target_channel: "salonboard", job_type: "update_reservation", status: "pending",
        request_payload: {
          external_reservation_id: (b as any).external_reservation_id,
          customer_name: (b as any).customers?.full_name,
          start_time: startISO, end_time: endISO,
          staff_name: (b as any).staff?.name ?? null,
          menu_name: (b as any).menu,
          source_channel: "manual_conflict_resolve_A",
        },
      }).select("id").maybeSingle();
      if (insErr) return new Response(JSON.stringify({ error: "job_insert_failed", message: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      await supabase.from("bookings").update({ sync_status: "pending", needs_manual_review: false }).eq("id", booking_id);
      supabase.functions.invoke("sync-job-dispatch", { body: { reservation_id: booking_id, job_ids: [ins!.id] } }).catch(() => {});
      return new Response(JSON.stringify({ action: "update_enqueued", job_id: ins!.id, message: "サロンボード側を SalonBoost の内容で更新するジョブを作成しました。" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (decision === "B") {
      // サロンボード側の内容で SalonBoost を更新する
      const { data: snap } = snapshot_id
        ? await supabase.from("sync_diff_snapshots").select("external_payload").eq("id", snapshot_id).maybeSingle()
        : await supabase.from("sync_diff_snapshots")
            .select("external_payload").eq("booking_id", booking_id)
            .order("checked_at", { ascending: false }).limit(1).maybeSingle();
      const items = (snap as any)?.external_payload?.items ?? [];
      const ext = items[0];
      if (!ext) return new Response(JSON.stringify({ error: "no_external_data", message: "サロンボード側の最新スナップショットが見つかりません。先に同期状態を確認してください。" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const updates: any = {
        sync_status: "synced", needs_manual_review: false, last_synced_at: new Date().toISOString(),
      };
      if (ext.external_reservation_id) updates.external_reservation_id = ext.external_reservation_id;
      if (ext.time && /^\d{2}:\d{2}$/.test(ext.time)) updates.booking_time = ext.time + ":00";
      // menu / customer はサロンボード側から取得できないため上書きしない
      const { error: upErr } = await supabase.from("bookings").update(updates).eq("id", booking_id);
      if (upErr) return new Response(JSON.stringify({ error: "booking_update_failed", message: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ action: "local_updated", message: "サロンボード側の内容で SalonBoost 予約を更新しました（時刻 / external_id のみ）。", applied: updates }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unhandled" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
