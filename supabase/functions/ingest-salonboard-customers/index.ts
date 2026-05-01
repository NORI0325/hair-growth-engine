// 拡張機能からスクレイプデータを直接受信して安全にDBへ保存
// CSVがローカルに残らない設計の核心
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SbCustomer = Record<string, string>;

function pick(c: SbCustomer, keys: string[]): string {
  for (const k of keys) {
    const v = (c[k] || "").trim();
    if (v && v !== "-") return v;
  }
  return "";
}

function parseDate(s: string): string | null {
  if (!s) return null;
  // YYYY/MM/DD or YYYY-MM-DD or 2024年5月1日 等
  const m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (!m) return null;
  const y = m[1], mo = String(m[2]).padStart(2, "0"), d = String(m[3]).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function normalizePhone(s: string): string {
  return (s || "").replace(/[^\d]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "ログインが必要です" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "認証に失敗しました" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const admin = createClient(supabaseUrl, serviceKey);

    // サブスク確認
    const { data: sub } = await admin
      .from("subscriptions")
      .select("status, trial_ends_at, current_period_end, owner_id")
      .or(`owner_id.eq.${user.id}`)
      .maybeSingle();

    const now = new Date();
    const isActive = sub && (
      sub.status === "active" ||
      (sub.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) ||
      (sub.current_period_end && new Date(sub.current_period_end) > now && sub.status !== "canceled")
    );

    // owner_id を解決：自分が owner ならそのまま、メンバーなら所属テナントの owner_user_id
    let ownerId = user.id;
    if (!isActive) {
      // 自分が owner でなければ、テナントの owner を取得して再チェック
      const { data: membership } = await admin
        .from("tenant_members")
        .select("tenant_id, role, tenants:tenant_id(owner_user_id)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (membership?.tenants && (membership.tenants as any).owner_user_id) {
        ownerId = (membership.tenants as any).owner_user_id;
        const { data: ownerSub } = await admin
          .from("subscriptions")
          .select("status, trial_ends_at, current_period_end")
          .eq("owner_id", ownerId)
          .maybeSingle();
        const ownerActive = ownerSub && (
          ownerSub.status === "active" ||
          (ownerSub.status === "trialing" && ownerSub.trial_ends_at && new Date(ownerSub.trial_ends_at) > now) ||
          (ownerSub.current_period_end && new Date(ownerSub.current_period_end) > now && ownerSub.status !== "canceled")
        );
        if (!ownerActive) {
          return new Response(JSON.stringify({ error: "ご契約が有効ではありません" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        return new Response(JSON.stringify({ error: "ご契約が有効ではありません" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.customers)) {
      return new Response(JSON.stringify({ error: "customers 配列が必要です" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const locationId: string | null = body.location_id || null;
    const reservations: any[] = Array.isArray(body.reservations) ? body.reservations : [];

    // location_id の所属確認
    if (locationId) {
      const { data: loc } = await admin
        .from("locations")
        .select("id, tenant_id")
        .eq("id", locationId)
        .maybeSingle();
      if (!loc) {
        return new Response(JSON.stringify({ error: "店舗が見つかりません" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let inserted = 0, updated = 0, skipped = 0;
    const errors: string[] = [];

    for (const c of body.customers as SbCustomer[]) {
      try {
        const sbId = pick(c, ["詳細_顧客ID"]);
        const sbNo = pick(c, ["詳細_お客様番号", "一覧_お客様番号"]);
        const fullName = pick(c, [
          "詳細_氏名（漢字）", "詳細_氏名(漢字)",
          "一覧_氏名（漢字）", "一覧_氏名(漢字)",
          "詳細_氏名（カナ）", "詳細_氏名(カナ)",
          "一覧_氏名（カナ）", "一覧_氏名(カナ)",
        ]);
        if (!fullName) { skipped++; continue; }

        const phoneRaw = pick(c, ["詳細_代表番号1", "詳細_代表番号2"]);
        const phone = normalizePhone(phoneRaw);
        const email = pick(c, [
          "詳細_E-MAIL（PC）", "詳細_E-MAIL(PC)",
          "詳細_E-MAIL（携帯）", "詳細_E-MAIL(携帯)",
          "詳細_メッセージ配信先情報_E-MAIL（PC）",
          "詳細_メッセージ配信先情報_E-MAIL（携帯）",
        ]);
        const birthday = parseDate(pick(c, ["詳細_誕生日"]));
        const lastVisit = parseDate(pick(c, ["一覧_前回来店日", "詳細_来店情報_前回来店日"]));
        const visitCountStr = pick(c, ["一覧_来店回数", "詳細_来店情報_来店回数"]);
        const visitCount = parseInt(visitCountStr.replace(/[^\d]/g, ""), 10) || 0;

        // 既存検索：1) salonboard_customer_id 2) 電話 3) 氏名
        let existing: any = null;
        if (sbId) {
          const { data } = await admin
            .from("customers")
            .select("id, visit_count")
            .eq("owner_id", ownerId)
            .eq("salonboard_customer_id", sbId)
            .maybeSingle();
          existing = data;
        }
        if (!existing && phone) {
          const { data } = await admin
            .from("customers")
            .select("id, visit_count")
            .eq("owner_id", ownerId)
            .eq("phone", phone)
            .maybeSingle();
          existing = data;
        }
        if (!existing) {
          const { data } = await admin
            .from("customers")
            .select("id, visit_count")
            .eq("owner_id", ownerId)
            .eq("full_name", fullName)
            .maybeSingle();
          existing = data;
        }

        const payload: any = {
          owner_id: ownerId,
          location_id: locationId,
          full_name: fullName,
          phone: phone || null,
          email: email || null,
          birthday,
          last_visit_date: lastVisit,
          visit_count: visitCount,
          salonboard_customer_id: sbId || null,
          salonboard_customer_no: sbNo || null,
          imported_from: "salonboard",
          last_imported_at: new Date().toISOString(),
        };

        if (existing) {
          // visit_count は大きい方を採用
          payload.visit_count = Math.max(existing.visit_count || 0, visitCount);
          const { error } = await admin.from("customers").update(payload).eq("id", existing.id);
          if (error) throw error;
          updated++;
        } else {
          const { error } = await admin.from("customers").insert(payload);
          if (error) throw error;
          inserted++;
        }
      } catch (e: any) {
        skipped++;
        errors.push(e?.message || String(e));
      }
    }

    // 監査ログ
    await admin.from("salonboard_import_logs").insert({
      user_id: user.id,
      owner_id: ownerId,
      location_id: locationId,
      source: "salonboard",
      total_received: body.customers.length,
      inserted_count: inserted,
      updated_count: updated,
      skipped_count: skipped,
      reservations_received: reservations.length,
      status: errors.length === body.customers.length ? "failed" : (errors.length ? "partial" : "success"),
      error: errors.slice(0, 5).join(" | ") || null,
      meta: { sample_errors: errors.slice(0, 10) },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        total: body.customers.length,
        inserted, updated, skipped,
        errors_sample: errors.slice(0, 5),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ingest-salonboard-customers error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
