// 拡張機能からスクレイプデータを直接受信して安全にDBへ保存
// CSVがローカルに残らない設計の核心
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    const identity = await authenticateRequest(req, admin);
    if (identity.kind !== "user") {
      return new Response(JSON.stringify({ error: "ログインが必要です" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: identity.userId };

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.customers) || body.customers.length > 10_000) {
      return new Response(JSON.stringify({ error: "customers 配列が必要です" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const locationId: string | null = typeof body.location_id === "string" ? body.location_id : null;
    const reservations: any[] = Array.isArray(body.reservations) ? body.reservations : [];

    if (!locationId) {
      return new Response(JSON.stringify({ error: "店舗を選択してください" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: loc } = await admin
      .from("locations")
      .select("id, tenant_id")
      .eq("id", locationId)
      .maybeSingle();
    if (!loc?.tenant_id) {
      return new Response(JSON.stringify({ error: "店舗が見つかりません" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ownerId = String(loc.tenant_id);
    const canImport = await canAccessOwner(admin, identity.userId, ownerId, ["owner", "manager", "super_admin"]);
    if (!canImport) {
      return new Response(JSON.stringify({ error: "顧客を取り込む権限がありません" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sub } = await admin
      .from("subscriptions")
      .select("status, trial_ends_at, current_period_end")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const now = new Date();
    const isActive = Boolean(sub && (
      sub.status === "active" ||
      (sub.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) ||
      (sub.current_period_end && new Date(sub.current_period_end) > now && sub.status !== "canceled")
    ));
    if (!isActive) {
      return new Response(JSON.stringify({ error: "ご契約が有効ではありません" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let inserted = 0, updated = 0, skipped = 0;
    const errors: string[] = [];

    // === Step 1: 受信データを正規化 ===
    type Gender = "female" | "male" | "other" | "unknown";
    function normalizeGender(s: string): Gender {
      const v = (s || "").trim();
      if (!v) return "unknown";
      if (/女/.test(v) || /female/i.test(v) || v === "F") return "female";
      if (/男/.test(v) || /male/i.test(v) || v === "M") return "male";
      if (/その他|other/i.test(v)) return "other";
      return "unknown";
    }
    type Norm = {
      sbId: string; sbNo: string; fullName: string; phone: string;
      email: string; birthday: string | null; lastVisit: string | null;
      visitCount: number; gender: Gender;
    };
    const normalized: Norm[] = [];
    for (const c of body.customers as SbCustomer[]) {
      const fullName = pick(c, [
        "詳細_氏名（漢字）", "詳細_氏名(漢字)",
        "一覧_氏名（漢字）", "一覧_氏名(漢字)",
        "詳細_氏名（カナ）", "詳細_氏名(カナ)",
        "一覧_氏名（カナ）", "一覧_氏名(カナ)",
      ]);
      if (!fullName) { skipped++; continue; }
      normalized.push({
        sbId: pick(c, ["詳細_顧客ID"]),
        sbNo: pick(c, ["詳細_お客様番号", "一覧_お客様番号"]),
        fullName,
        phone: normalizePhone(pick(c, ["詳細_代表番号1", "詳細_代表番号2"])),
        email: pick(c, [
          "詳細_E-MAIL（PC）", "詳細_E-MAIL(PC)",
          "詳細_E-MAIL（携帯）", "詳細_E-MAIL(携帯)",
          "詳細_メッセージ配信先情報_E-MAIL（PC）",
          "詳細_メッセージ配信先情報_E-MAIL（携帯）",
        ]).toLowerCase(),
        birthday: parseDate(pick(c, ["詳細_誕生日"])),
        lastVisit: parseDate(pick(c, ["一覧_前回来店日", "詳細_来店情報_前回来店日"])),
        visitCount: parseInt((pick(c, ["一覧_来店回数", "詳細_来店情報_来店回数"]) || "").replace(/[^\d]/g, ""), 10) || 0,
        gender: normalizeGender(pick(c, ["gender", "sex", "性別", "詳細_性別", "一覧_性別", "詳細_基本情報_性別"])),
      });
    }

    // === Step 2: 既存顧客を一括取得（既存値も全取得して穴埋めに使う） ===
    const sbIds = [...new Set(normalized.map(n => n.sbId).filter(Boolean))];
    const phones = [...new Set(normalized.map(n => n.phone).filter(Boolean))];
    const names = [...new Set(normalized.map(n => n.fullName))];

    type Existing = {
      id: string; full_name: string; location_id: string | null; visit_count: number;
      phone: string | null; email: string | null; birthday: string | null;
      gender: string | null; last_visit_date: string | null;
      salonboard_customer_id: string | null; salonboard_customer_no: string | null;
    };
    const bySbId = new Map<string, Existing[]>();
    const byPhone = new Map<string, Existing[]>();
    const byName = new Map<string, Existing[]>();

    const CHUNK = 500;
    const SELECT_COLS = "id, full_name, location_id, visit_count, phone, email, birthday, gender, last_visit_date, salonboard_customer_id, salonboard_customer_no";
    async function fetchExisting(col: string, values: string[], target: Map<string, Existing[]>) {
      for (let i = 0; i < values.length; i += CHUNK) {
        const slice = values.slice(i, i + CHUNK);
        const { data, error } = await admin
          .from("customers")
          .select(SELECT_COLS)
          .eq("owner_id", ownerId)
          .in(col, slice);
        if (error) throw error;
        for (const row of (data || []) as any[]) {
          const key = row[col];
          if (key) target.set(key, [...(target.get(key) || []), row as Existing]);
        }
      }
    }
    if (sbIds.length) await fetchExisting("salonboard_customer_id", sbIds, bySbId);
    if (phones.length) await fetchExisting("phone", phones, byPhone);
    if (names.length) await fetchExisting("full_name", names, byName);

    // === Step 3: 更新と新規挿入を分類（穴埋め型マージ） ===
    const nowIso = new Date().toISOString();
    const toUpdate: { id: string; payload: any }[] = [];
    const toInsert: any[] = [];
    const seenUpdateIds = new Set<string>();
    const seenIncomingStrongIds = new Set<string>();

    // 受信値が「実質空」かを判定
    const blank = (v: any) => v === null || v === undefined || v === "" || v === "unknown";

    for (const n of normalized) {
      const incomingKey = n.sbId ? `sb:${n.sbId}` : n.phone ? `phone:${n.phone}` : "";
      if (incomingKey && seenIncomingStrongIds.has(incomingKey)) {
        skipped++;
        errors.push(`入力データ内で顧客識別子が重複しています (${incomingKey.split(":")[0]})`);
        continue;
      }
      if (incomingKey) seenIncomingStrongIds.add(incomingKey);

      const strongMatches = new Map<string, Existing>();
      for (const match of n.sbId ? (bySbId.get(n.sbId) || []) : []) strongMatches.set(match.id, match);
      for (const match of n.phone ? (byPhone.get(n.phone) || []) : []) strongMatches.set(match.id, match);
      if (strongMatches.size > 1) {
        skipped++;
        errors.push("サロンボード顧客IDと電話番号が異なる既存顧客に一致しました");
        continue;
      }

      let existing = strongMatches.values().next().value as Existing | undefined;
      if (!existing && !n.sbId && !n.phone) {
        const sameLocationNames = (byName.get(n.fullName) || []).filter(row => row.location_id === locationId);
        if (sameLocationNames.length > 1) {
          skipped++;
          errors.push("同名顧客が複数いるため自動統合を停止しました");
          continue;
        }
        existing = sameLocationNames[0];
      }

      if (existing) {
        if (seenUpdateIds.has(existing.id)) { skipped++; continue; }
        seenUpdateIds.add(existing.id);

        // coalesce: 受信が空なら既存値を保持
        const payload: any = {
          full_name: n.fullName, // マッチキー、常に維持
          phone: blank(n.phone) ? existing.phone : n.phone,
          email: blank(n.email) ? existing.email : n.email,
          birthday: blank(n.birthday) ? existing.birthday : n.birthday,
          gender: blank(n.gender) ? (existing.gender || "unknown") : n.gender,
          salonboard_customer_id: blank(n.sbId) ? existing.salonboard_customer_id : n.sbId,
          salonboard_customer_no: blank(n.sbNo) ? existing.salonboard_customer_no : n.sbNo,
          // 来店日は新しい方
          last_visit_date: (() => {
            if (blank(n.lastVisit)) return existing.last_visit_date;
            if (!existing.last_visit_date) return n.lastVisit;
            return n.lastVisit! > existing.last_visit_date ? n.lastVisit : existing.last_visit_date;
          })(),
          visit_count: Math.max(existing.visit_count || 0, n.visitCount),
          imported_from: "salonboard",
          last_imported_at: nowIso,
        };
        toUpdate.push({ id: existing.id, payload });
      } else {
        toInsert.push({
          owner_id: ownerId,
          location_id: locationId,
          full_name: n.fullName,
          phone: n.phone || null,
          email: n.email || null,
          birthday: n.birthday,
          gender: n.gender,
          last_visit_date: n.lastVisit,
          visit_count: n.visitCount,
          salonboard_customer_id: n.sbId || null,
          salonboard_customer_no: n.sbNo || null,
          imported_from: "salonboard",
          last_imported_at: nowIso,
          first_imported_at: nowIso,
        });
      }
    }

    // === Step 4: チャンクで一括 INSERT ===
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const slice = toInsert.slice(i, i + CHUNK);
      const { error, data } = await admin.from("customers").insert(slice).select("id");
      if (error) {
        // フォールバック：個別挿入で失敗した行を特定
        for (const row of slice) {
          const { error: e2 } = await admin.from("customers").insert(row);
          if (e2) { skipped++; errors.push(e2.message); } else { inserted++; }
        }
      } else {
        inserted += (data?.length ?? slice.length);
      }
    }

    // === Step 5: UPDATE は並列で（10並行） ===
    const PARALLEL = 10;
    for (let i = 0; i < toUpdate.length; i += PARALLEL) {
      const batch = toUpdate.slice(i, i + PARALLEL);
      const results = await Promise.all(
        batch.map(({ id, payload }) =>
          admin.from("customers").update(payload).eq("id", id).then((r) => ({ id, error: r.error }))
        )
      );
      for (const r of results) {
        if (r.error) { skipped++; errors.push(r.error.message); } else { updated++; }
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
