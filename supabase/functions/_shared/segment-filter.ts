// 一斉送信用セグメントフィルタ（broadcast-preview と bulk-broadcast で共有）
// 入力: 顧客一覧 + 各種補助データ + セグメント条件
// 出力: 条件に合致する顧客のサブセット

export interface SegmentInput {
  genders?: string[];
  age_groups?: string[];
  days_since_min?: number | null;
  days_since_max?: number | null;
  vip_only?: boolean;
  menu_keyword?: string | null;
  visit_count_min?: number | null;
  visit_count_max?: number | null;
  total_spent_min?: number | null;
  total_spent_max?: number | null;
  staff_ids?: string[];
  birthday_months?: number[];
  tag_ids_any?: string[];        // いずれかを持つ
  exclude_tag_ids?: string[];    // 除外
  has_email?: boolean;
  has_phone?: boolean;
  has_line?: boolean;
  recommended_cycle_days?: number | null;       // 例: 45
  recommended_tolerance_days?: number | null;   // 例: 7（前後7日）
}

export interface FilterContext {
  // customer_id -> 最新メニュー
  lastMenu: Record<string, string | null>;
  // customer_id -> 最新担当スタッフID
  lastStaffId: Record<string, string | null>;
  // customer_id -> 持っているタグID集合
  customerTagIds: Record<string, Set<string>>;
  // customer_id -> 直近N日に予約がある（true で除外対象）
  recentBookingSet: Set<string>;
}

async function fetchAllPages<T>(makeQuery: () => any, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function tokyoDateOffset(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

export const ageGroupOf = (birthday: string | null | undefined): string | null => {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  if (age < 20) return "teens";
  if (age < 30) return "20s";
  if (age < 40) return "30s";
  if (age < 50) return "40s";
  if (age < 60) return "50s";
  return "60s+";
};

const isVip = (c: any) => (c.total_spent || 0) >= 150000 || (c.visit_count || 0) >= 15;
const daysSince = (c: any) =>
  c.last_visit_date ? Math.floor((Date.now() - new Date(c.last_visit_date).getTime()) / 86400000) : null;
const isValidLineUserId = (s: string | null | undefined) => !!s && /^U[0-9a-f]{32}$/i.test(s);

export const applySegmentFilter = (
  customers: any[],
  seg: SegmentInput,
  ctx: FilterContext
): { matched: any[]; segmentSkipped: number; recentBookingSkipped: number } => {
  let recentBookingSkipped = 0;
  const beforeAll = customers.length;

  const matched = customers.filter((c) => {
    // 性別
    if (seg.genders && seg.genders.length > 0 && !seg.genders.includes(c.gender || "unknown")) return false;
    // 年代
    if (seg.age_groups && seg.age_groups.length > 0) {
      const ag = ageGroupOf(c.birthday);
      if (!ag || !seg.age_groups.includes(ag)) return false;
    }
    // 最終来店日数
    const ds = daysSince(c);
    if (seg.days_since_min !== null && seg.days_since_min !== undefined) {
      if (ds === null || ds < seg.days_since_min) return false;
    }
    if (seg.days_since_max !== null && seg.days_since_max !== undefined) {
      if (ds === null || ds > seg.days_since_max) return false;
    }
    // VIP
    if (seg.vip_only && !isVip(c)) return false;
    // 来店回数
    if (seg.visit_count_min !== null && seg.visit_count_min !== undefined) {
      if ((c.visit_count || 0) < seg.visit_count_min) return false;
    }
    if (seg.visit_count_max !== null && seg.visit_count_max !== undefined) {
      if ((c.visit_count || 0) > seg.visit_count_max) return false;
    }
    // 累計売上
    if (seg.total_spent_min !== null && seg.total_spent_min !== undefined) {
      if ((c.total_spent || 0) < seg.total_spent_min) return false;
    }
    if (seg.total_spent_max !== null && seg.total_spent_max !== undefined) {
      if ((c.total_spent || 0) > seg.total_spent_max) return false;
    }
    // 担当スタッフ
    if (seg.staff_ids && seg.staff_ids.length > 0) {
      const sid = ctx.lastStaffId[c.id];
      if (!sid || !seg.staff_ids.includes(sid)) return false;
    }
    // 誕生月
    if (seg.birthday_months && seg.birthday_months.length > 0) {
      if (!c.birthday) return false;
      const bd = new Date(c.birthday);
      if (isNaN(bd.getTime())) return false;
      if (!seg.birthday_months.includes(bd.getMonth() + 1)) return false;
    }
    // 前回メニューキーワード
    if (seg.menu_keyword) {
      const m = (ctx.lastMenu[c.id] || "").toLowerCase();
      if (!m.includes(seg.menu_keyword.toLowerCase())) return false;
    }
    // タグ（いずれかを持つ）
    if (seg.tag_ids_any && seg.tag_ids_any.length > 0) {
      const tags = ctx.customerTagIds[c.id];
      if (!tags || !seg.tag_ids_any.some((t) => tags.has(t))) return false;
    }
    // タグ除外
    if (seg.exclude_tag_ids && seg.exclude_tag_ids.length > 0) {
      const tags = ctx.customerTagIds[c.id];
      if (tags && seg.exclude_tag_ids.some((t) => tags.has(t))) return false;
    }
    // チャネル所持
    if (seg.has_email && !c.email) return false;
    if (seg.has_phone && !c.phone) return false;
    if (seg.has_line && !isValidLineUserId(c.line_user_id)) return false;
    // 次回来店推奨日 ±tolerance
    if (seg.recommended_cycle_days && seg.recommended_cycle_days > 0) {
      if (ds === null) return false;
      const tol = Math.max(0, seg.recommended_tolerance_days || 7);
      const diff = ds - seg.recommended_cycle_days; // 0 = ちょうど推奨日
      if (Math.abs(diff) > tol) return false;
    }
    // 直近予約除外
    if (ctx.recentBookingSet.has(c.id)) {
      recentBookingSkipped++;
      return false;
    }
    return true;
  });

  const segmentSkipped = beforeAll - matched.length - recentBookingSkipped;
  return { matched, segmentSkipped, recentBookingSkipped };
};

// 補助データを取得（bulk-broadcast / preview 共通）
export async function buildFilterContext(
  supabase: any,
  ownerId: string,
  customerIds: string[],
  excludeRecentBookingDays: number
): Promise<FilterContext> {
  const ctx: FilterContext = {
    lastMenu: {},
    lastStaffId: {},
    customerTagIds: {},
    recentBookingSet: new Set(),
  };
  if (customerIds.length === 0) return ctx;

  // 最新トリートメント
  const treats = await fetchAllPages<any>(() => supabase
    .from("chart_treatments")
    .select("customer_id, menu_summary, staff_id, treatment_date")
    .eq("owner_id", ownerId)
    .in("customer_id", customerIds)
    .order("treatment_date", { ascending: false }));
  const seen = new Set<string>();
  for (const t of treats) {
    if (seen.has(t.customer_id)) continue;
    seen.add(t.customer_id);
    ctx.lastMenu[t.customer_id] = t.menu_summary;
    ctx.lastStaffId[t.customer_id] = t.staff_id;
  }

  // タグ
  const tags = await fetchAllPages<any>(() => supabase
    .from("customer_tag_assignments")
    .select("customer_id, tag_id")
    .eq("owner_id", ownerId)
    .in("customer_id", customerIds));
  for (const t of tags) {
    if (!ctx.customerTagIds[t.customer_id]) ctx.customerTagIds[t.customer_id] = new Set();
    ctx.customerTagIds[t.customer_id].add(t.tag_id);
  }

  // 直近予約（今日以降 〜 excludeRecentBookingDays 日先まで）
  if (excludeRecentBookingDays > 0) {
    const today = tokyoDateOffset(0);
    const future = tokyoDateOffset(excludeRecentBookingDays);
    const bookings = await fetchAllPages<any>(() => supabase
      .from("bookings")
      .select("customer_id, status")
      .eq("owner_id", ownerId)
      .in("customer_id", customerIds)
      .gte("booking_date", today)
      .lte("booking_date", future)
      .in("status", ["pending", "confirmed"]));
    for (const b of bookings) ctx.recentBookingSet.add(b.customer_id);
  }

  return ctx;
}
