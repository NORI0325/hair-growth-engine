import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import ChurnAlertPanel from "@/components/ChurnAlertPanel";
import SetupChecklist from "@/components/SetupChecklist";
import NotificationRecipientsBadge from "@/components/NotificationRecipientsBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Calendar, Inbox, AlertTriangle, Cake, UserPlus, Sparkles,
  TrendingUp, Clock, ArrowRight, Crown,
} from "lucide-react";
import { tierInfo, type VipTier } from "@/lib/vip";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import { addDaysToDateKey, dateKeyInJst, monthStartInJst } from "@/lib/jst-date";

// --------------- 型 ---------------
interface TodayBooking {
  id: string;
  booking_time: string;
  menu: string;
  status: string;
  revenue: number | null;
  total_price: number | null;
  customer_name: string | null;
}
interface AtRiskCustomer {
  id: string; full_name: string; last_visit_date: string | null; total_spent: number;
}
interface BirthdayCustomer {
  id: string; full_name: string; birthday: string;
}
interface RevenueDay { date: string; revenue: number; bookings: number; }
interface TodayBookingRow {
  id: string;
  booking_time: string;
  menu: string;
  status: string;
  revenue: number | null;
  total_price: number | null;
  customers: { full_name?: string | null } | null;
}
interface TrendBookingRow { booking_date: string; revenue: number | null; status: string }
interface WeekBookingRow { booking_date: string; status: string }

interface DashboardData {
  today: TodayBooking[];
  todayRevenuePotential: number;
  todayCompletedRevenue: number;
  unreadInbox: number;
  pendingLineFriends: number;
  atRisk: AtRiskCustomer[];
  atRiskTotal: number;
  birthdays: BirthdayCustomer[];
  monthlyRevenue: number;
  monthlyBookings: number;
  campaignBookings: number;
  totalCustomers: number;
  vipDistribution: Record<VipTier, number>;
  revenueTrend: RevenueDay[];
  weekOccupancy: { date: string; weekday: string; count: number }[];
}

// --------------- 共通 ---------------
const fmtYen = (n: number) => `¥${n.toLocaleString()}`;
type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;
const callDashboardRpc = (name: string, args: Record<string, unknown>): RpcResult =>
  (supabase.rpc as unknown as (fn: string, params: Record<string, unknown>) => RpcResult)(name, args);

const Dashboard = () => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const tenantId = useTenantId();
  const todayKey = dateKeyInJst();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!user || !tenantId || !locationId) return;
    const load = async () => {
      const now = new Date();
      const startOfMonth = monthStartInJst(now);
      const trendStartKey = addDaysToDateKey(todayKey, -29);
      const weekEndKey = addDaysToDateKey(todayKey, 6);
      const atRiskFromKey = addDaysToDateKey(todayKey, -180);
      const atRiskToKey = addDaysToDateKey(todayKey, -90);

      const [
        todayRes, monthBookingsRes, monthCompletedRes, unreadRes, pendingRes,
        atRiskRes, customerInsightsRes, campaignBookingsRes, weekRes,
      ] = await Promise.all([
        // 今日の予約
        supabase.from("bookings")
          .select("id, booking_time, menu, status, revenue, total_price, customers(full_name)")
          .eq("location_id", locationId).eq("is_test", false)
          .eq("booking_date", todayKey)
          .order("booking_time", { ascending: true }),
        // 今月の予約数
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("location_id", locationId).eq("is_test", false).gte("booking_date", startOfMonth),
        // 過去30日の売上トレンド用
        supabase.from("bookings").select("booking_date, revenue, status")
          .eq("location_id", locationId).eq("is_test", false)
          .gte("booking_date", trendStartKey).lte("booking_date", todayKey),
        // 未読LINE
        supabase.from("line_inbound_messages").select("id", { count: "exact", head: true })
          .eq("location_id", locationId).eq("handled", false),
        // 未連携LINE友だち
        supabase.from("line_pending_friends").select("id", { count: "exact", head: true })
          .eq("location_id", locationId),
        // 離脱予備軍
        supabase.from("customers")
          .select("id, full_name, last_visit_date, total_spent", { count: "exact" })
          .eq("location_id", locationId).eq("is_test", false)
          .gte("last_visit_date", atRiskFromKey).lt("last_visit_date", atRiskToKey)
          .order("total_spent", { ascending: false }).limit(5),
        // 顧客数・VIP・誕生日はDB集計し、APIの行数上限に依存しない
        callDashboardRpc("dashboard_customer_insights_v1", {
          _owner_id: tenantId,
          _location_id: locationId,
        }),
        // 配信経由予約
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("location_id", locationId).eq("is_test", false)
          .not("campaign_id", "is", null).gte("booking_date", startOfMonth),
        // 来週の予約ヒートマップ
        supabase.from("bookings").select("booking_date, status")
          .eq("location_id", locationId).eq("is_test", false)
          .gte("booking_date", todayKey).lte("booking_date", weekEndKey)
          .neq("status", "cancelled"),
      ]);

      // ----- 今日の予約 -----
      const today: TodayBooking[] = ((todayRes.data || []) as unknown as TodayBookingRow[]).map((b) => ({
        id: b.id,
        booking_time: b.booking_time,
        menu: b.menu,
        status: b.status,
        revenue: b.revenue,
        total_price: b.total_price,
        customer_name: b.customers?.full_name ?? null,
      }));
      const todayRevenuePotential = today
        .filter(b => b.status !== "cancelled")
        .reduce((s, b) => s + (b.revenue || b.total_price || 0), 0);
      const todayCompletedRevenue = today
        .filter(b => b.status === "completed")
        .reduce((s, b) => s + (b.revenue || 0), 0);

      // ----- 売上トレンド (直近30日) -----
      const dayMap: Record<string, RevenueDay> = {};
      for (let i = 29; i >= 0; i--) {
        const k = addDaysToDateKey(todayKey, -i);
        dayMap[k] = { date: k, revenue: 0, bookings: 0 };
      }
      let monthRevenue = 0;
      ((monthCompletedRes.data || []) as TrendBookingRow[]).forEach((b) => {
        if (dayMap[b.booking_date]) {
          if (b.status !== "cancelled") dayMap[b.booking_date].bookings++;
          if (b.status === "completed") {
            dayMap[b.booking_date].revenue += b.revenue || 0;
          }
        }
        if (b.status === "completed" && b.booking_date >= startOfMonth) {
          monthRevenue += b.revenue || 0;
        }
      });
      const revenueTrend = Object.values(dayMap);

      // ----- VIP分布 & 誕生月 -----
      if (customerInsightsRes.error) {
        console.warn("[dashboard] customer insights failed", { message: customerInsightsRes.error.message, locationId });
      }
      const customerInsights = (customerInsightsRes.data || {}) as {
        total_customers?: number | string;
        vip_distribution?: Partial<Record<VipTier, number | string>>;
        birthdays?: BirthdayCustomer[];
      };
      const vipDistribution: Record<VipTier, number> = {
        platinum: Number(customerInsights.vip_distribution?.platinum || 0),
        gold: Number(customerInsights.vip_distribution?.gold || 0),
        silver: Number(customerInsights.vip_distribution?.silver || 0),
        bronze: Number(customerInsights.vip_distribution?.bronze || 0),
      };
      const birthdays = Array.isArray(customerInsights.birthdays) ? customerInsights.birthdays : [];

      // ----- 来週ヒートマップ -----
      const weekMap: Record<string, number> = {};
      for (let i = 0; i < 7; i++) {
        weekMap[addDaysToDateKey(todayKey, i)] = 0;
      }
      ((weekRes.data || []) as WeekBookingRow[]).forEach((b) => {
        if (weekMap[b.booking_date] !== undefined) weekMap[b.booking_date]++;
      });
      const weekdayJa = ["日", "月", "火", "水", "木", "金", "土"];
      const weekOccupancy = Object.entries(weekMap).map(([k, v]) => ({
        date: k,
        weekday: weekdayJa[new Date(`${k}T00:00:00+09:00`).getDay()],
        count: v,
      }));

      setData({
        today,
        todayRevenuePotential,
        todayCompletedRevenue,
        unreadInbox: unreadRes.count || 0,
        pendingLineFriends: pendingRes.count || 0,
        atRisk: (atRiskRes.data || []) as AtRiskCustomer[],
        atRiskTotal: atRiskRes.count || 0,
        birthdays,
        monthlyRevenue: monthRevenue,
        monthlyBookings: monthBookingsRes.count || 0,
        campaignBookings: campaignBookingsRes.count || 0,
        totalCustomers: Number(customerInsights.total_customers || 0),
        vipDistribution,
        revenueTrend,
        weekOccupancy,
      });
    };
    load();
  }, [user, tenantId, locationId, todayKey]);

  const maxRevenue = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.revenueTrend.map(d => d.revenue), 1);
  }, [data]);
  const maxOccupancy = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.weekOccupancy.map(d => d.count), 1);
  }, [data]);

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.01 — Today"
        title="ダッシュボード"
        description={`${new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })} ／ サロンの今を一望できます。`}
      />

      <SetupChecklist />
      <NotificationRecipientsBadge variant="dashboard" />
      <ChurnAlertPanel />

      {/* ============ ① 今日の戦況ボード ============ */}
      <section className="mb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border">
          {/* 今日の予約タイムライン */}
          <div className="lg:col-span-2 bg-card p-8">
            <div className="flex items-baseline justify-between mb-6">
              <div>
                <p className="eyebrow text-[10px] text-gold mb-1">— Today's Schedule —</p>
                <h3 className="display text-xl">本日の予約</h3>
              </div>
              <Link to="/bookings" className="text-[11px] eyebrow text-muted-foreground hover:text-gold flex items-center gap-1">
                すべて <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {!data ? (
              <Skeleton className="h-40 w-full" />
            ) : data.today.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Calendar className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-serif">本日の予約はありません</p>
                <p className="text-[11px] mt-1">ゆっくりとした一日を。</p>
              </div>
            ) : (
              <div className="space-y-px">
                {data.today.map(b => {
                  const statusColor =
                    b.status === "completed" ? "text-success border-success/30" :
                    b.status === "cancelled" ? "text-destructive border-destructive/30 line-through opacity-50" :
                    b.status === "confirmed" ? "text-gold border-gold/30" :
                    "text-muted-foreground border-border";
                  const statusLabel =
                    b.status === "completed" ? "来店済" :
                    b.status === "cancelled" ? "キャンセル" :
                    b.status === "confirmed" ? "確定" : "未確定";
                  return (
                    <div key={b.id} className="grid grid-cols-12 gap-3 py-3 border-b border-border/50 items-center">
                      <div className="col-span-2 font-serif-en text-2xl">{b.booking_time.slice(0, 5)}</div>
                      <div className="col-span-4 font-serif text-sm truncate">{b.customer_name || "—"}</div>
                      <div className="col-span-3 text-xs text-muted-foreground truncate">{b.menu}</div>
                      <div className="col-span-2 text-right text-xs font-serif-en">
                        {b.revenue ? fmtYen(b.revenue) : b.total_price ? `予${fmtYen(b.total_price)}` : "—"}
                      </div>
                      <div className="col-span-1 text-right">
                        <span className={`text-[9px] tracking-wider px-1.5 py-0.5 border ${statusColor}`}>{statusLabel}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 今日の数字 */}
          <div className="bg-card p-8 space-y-6">
            <div>
              <p className="eyebrow text-[10px] text-gold mb-1">— Today's Numbers —</p>
              <h3 className="display text-xl">今日の指標</h3>
            </div>

            <div className="space-y-5">
              <div className="border-b border-border pb-4">
                <div className="text-[10px] eyebrow text-muted-foreground mb-1">予約件数</div>
                {!data ? <Skeleton className="h-8 w-16" /> :
                  <div className="display text-3xl">{data.today.filter(b => b.status !== "cancelled").length}<span className="text-sm text-muted-foreground ml-1">件</span></div>
                }
              </div>
              <div className="border-b border-border pb-4">
                <div className="text-[10px] eyebrow text-muted-foreground mb-1">売上見込み</div>
                {!data ? <Skeleton className="h-8 w-24" /> :
                  <div className="display text-2xl text-gold">{fmtYen(data.todayRevenuePotential)}</div>
                }
              </div>
              <div>
                <div className="text-[10px] eyebrow text-muted-foreground mb-1">確定済み売上</div>
                {!data ? <Skeleton className="h-8 w-24" /> :
                  <div className="display text-2xl">{fmtYen(data.todayCompletedRevenue)}</div>
                }
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ ② 今すぐ打つべき手 ============ */}
      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <p className="eyebrow text-[10px] text-gold mb-1">— Action Center —</p>
            <h3 className="display text-2xl">今すぐ打つべき一手</h3>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border">
          {/* 未読LINE */}
          <ActionCard
            icon={<Inbox className="w-4 h-4" />}
            title="未読のLINE"
            value={data?.unreadInbox}
            unit="件"
            description="お客様からの問い合わせに今すぐ返信を"
            cta="受信トレイへ"
            to="/inbox"
            urgent={(data?.unreadInbox ?? 0) > 0}
          />
          {/* 離脱予備軍 */}
          <ActionCard
            icon={<AlertTriangle className="w-4 h-4" />}
            title="離脱予備軍"
            value={data?.atRiskTotal}
            unit="名"
            description="90〜180日来店なし。再来促進が効きます"
            cta="再活性化メール"
            to="/campaigns"
            urgent={(data?.atRiskTotal ?? 0) >= 5}
          />
          {/* 誕生月 */}
          <ActionCard
            icon={<Cake className="w-4 h-4" />}
            title="今月の誕生日"
            value={data?.birthdays.length}
            unit="名"
            description="バースデークーポンが最も効く瞬間です"
            cta="特典マスター"
            to="/incentives"
            urgent={false}
          />
          {/* 未連携LINE友だち */}
          <ActionCard
            icon={<UserPlus className="w-4 h-4" />}
            title="未連携LINE友だち"
            value={data?.pendingLineFriends}
            unit="名"
            description="顧客台帳と紐づければ自動配信の対象に"
            cta="顧客一覧へ"
            to="/customers"
            urgent={(data?.pendingLineFriends ?? 0) > 0}
          />
        </div>
      </section>

      {/* ============ ③ 売上トレンド & 来週の予約ヒート ============ */}
      <section className="mb-16 grid grid-cols-1 lg:grid-cols-3 gap-px bg-border">
        {/* 売上トレンド (lg:2) */}
        <div className="lg:col-span-2 bg-card p-8">
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <p className="eyebrow text-[10px] text-gold mb-1">— Revenue Trend —</p>
              <h3 className="display text-xl">直近30日の売上</h3>
            </div>
            <div className="text-right">
              <div className="text-[10px] eyebrow text-muted-foreground">今月累計</div>
              <div className="display text-2xl">{data ? fmtYen(data.monthlyRevenue) : "—"}</div>
            </div>
          </div>

          {!data ? <Skeleton className="h-44 w-full mt-6" /> : (
            <div className="mt-8">
              <div className="relative h-44 flex items-end gap-1">
                {data.revenueTrend.map((d, i) => {
                  const h = (d.revenue / maxRevenue) * 100;
                  const isToday = d.date === todayKey;
                  return (
                    <div key={d.date} className="flex-1 group relative flex items-end" style={{ minWidth: 0 }}>
                      <div
                        className={`w-full transition-all ${
                          isToday ? "bg-gold" : d.revenue > 0 ? "bg-foreground/70 group-hover:bg-gold" : "bg-border"
                        }`}
                        style={{ height: `${Math.max(h, 1)}%` }}
                        title={`${d.date} ¥${d.revenue.toLocaleString()} (${d.bookings}件)`}
                      />
                      {/* tooltip */}
                      <div className="absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-foreground text-background text-[10px] px-2 py-1 whitespace-nowrap pointer-events-none z-10">
                        {d.date.slice(5)}<br />{fmtYen(d.revenue)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] eyebrow text-muted-foreground mt-2">
                <span>{data.revenueTrend[0]?.date.slice(5)}</span>
                <span>今日</span>
              </div>
            </div>
          )}
        </div>

        {/* 来週ヒート */}
        <div className="bg-card p-8">
          <div className="mb-6">
            <p className="eyebrow text-[10px] text-gold mb-1">— Next 7 Days —</p>
            <h3 className="display text-xl">これからの一週間</h3>
          </div>
          {!data ? <Skeleton className="h-40 w-full" /> : (
            <div className="space-y-2">
              {data.weekOccupancy.map((d) => {
                const intensity = (d.count / maxOccupancy) * 100;
                const isToday = d.date === todayKey;
                return (
                  <div key={d.date} className="flex items-center gap-3">
                    <div className={`w-12 text-[11px] font-serif ${isToday ? "text-gold font-bold" : "text-muted-foreground"}`}>
                      {d.date.slice(5)} {d.weekday}
                    </div>
                    <div className="flex-1 h-5 bg-secondary/40 relative">
                      <div
                        className={`absolute top-0 left-0 h-5 transition-all ${isToday ? "bg-gold" : "bg-foreground/70"}`}
                        style={{ width: `${intensity}%` }}
                      />
                    </div>
                    <div className="w-8 text-right text-xs font-serif-en">{d.count}</div>
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground mt-4 leading-relaxed">
                空いている日は配信のチャンス。離脱予備軍へ送ると効果的です。
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ============ ④ 詳細ピックアップ（離脱予備軍 & 誕生日） ============ */}
      <section className="mb-16 grid grid-cols-1 lg:grid-cols-2 gap-px bg-border">
        {/* 離脱予備軍トップ5 */}
        <div className="bg-card p-8">
          <div className="flex items-baseline justify-between mb-6">
            <div>
              <p className="eyebrow text-[10px] text-amber-600 mb-1">— Win-Back Priority —</p>
              <h3 className="display text-xl">離脱予備軍 TOP 5</h3>
            </div>
            <Link to="/customers" className="text-[11px] eyebrow text-muted-foreground hover:text-gold flex items-center gap-1">
              全件 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {!data ? <Skeleton className="h-32" /> : data.atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">該当するお客様はいません ✨</p>
          ) : (
            <div className="space-y-2">
              {data.atRisk.map(c => {
                const days = c.last_visit_date
                  ? Math.floor((new Date(`${todayKey}T00:00:00+09:00`).getTime() - new Date(`${c.last_visit_date}T00:00:00+09:00`).getTime()) / 86400000)
                  : 0;
                return (
                  <div key={c.id} className="flex items-center justify-between py-3 border-b border-border/50">
                    <div>
                      <div className="font-serif text-sm">{c.full_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        最終来店 {c.last_visit_date} <span className="text-amber-600">（{days}日前）</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-serif-en text-sm">{fmtYen(c.total_spent)}</div>
                      <div className="text-[10px] eyebrow text-muted-foreground">累計</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 今月誕生日 */}
        <div className="bg-card p-8">
          <div className="flex items-baseline justify-between mb-6">
            <div>
              <p className="eyebrow text-[10px] text-gold mb-1">— Birthday This Month —</p>
              <h3 className="display text-xl">今月のお誕生日</h3>
            </div>
            <Link to="/customers" className="text-[11px] eyebrow text-muted-foreground hover:text-gold flex items-center gap-1">
              詳細 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {!data ? <Skeleton className="h-32" /> : data.birthdays.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">今月誕生日のお客様はいません</p>
          ) : (
            <div className="space-y-2">
              {data.birthdays.slice(0, 6).map(c => {
                const d = new Date(c.birthday);
                const day = d.getDate();
                const dayKey = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
                return (
                  <div key={c.id} className="flex items-center justify-between py-3 border-b border-border/50">
                    <div className="flex items-center gap-3">
                      <Cake className="w-4 h-4 text-gold" />
                      <div>
                        <div className="font-serif text-sm">{c.full_name}</div>
                        <div className="text-[11px] text-muted-foreground">{dayKey}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {data.birthdays.length > 6 && (
                <div className="text-[10px] text-muted-foreground text-center pt-2">
                  ほか {data.birthdays.length - 6} 名
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ============ ⑤ 月次サマリー & VIP ============ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border">
        {/* 月次 */}
        <div className="bg-card p-8">
          <p className="eyebrow text-[10px] text-gold mb-1">— Monthly —</p>
          <h3 className="display text-xl mb-6">今月のサマリー</h3>
          <div className="space-y-4">
            <SummaryRow icon={<TrendingUp className="w-3.5 h-3.5" />} label="売上（来店済）" value={data ? fmtYen(data.monthlyRevenue) : "—"} />
            <SummaryRow icon={<Calendar className="w-3.5 h-3.5" />} label="予約件数" value={data ? `${data.monthlyBookings} 件` : "—"} />
            <SummaryRow icon={<Sparkles className="w-3.5 h-3.5" />} label="配信経由の予約" value={data ? `${data.campaignBookings} 件` : "—"} />
            <SummaryRow icon={<Clock className="w-3.5 h-3.5" />} label="顧客総数" value={data ? `${data.totalCustomers.toLocaleString()} 名` : "—"} />
          </div>
        </div>

        {/* VIP */}
        <div className="bg-card p-8">
          <div className="flex items-center gap-2 mb-1">
            <Crown className="w-3.5 h-3.5 text-gold" />
            <p className="eyebrow text-[10px] text-gold">— VIP Distribution —</p>
          </div>
          <h3 className="display text-xl mb-6">お客様のランク構成</h3>
          {!data ? <Skeleton className="h-40" /> : (
            <div className="space-y-4">
              {(["platinum", "gold", "silver", "bronze"] as VipTier[]).map(t => {
                const total = Object.values(data.vipDistribution).reduce((a, b) => a + b, 0);
                const count = data.vipDistribution[t];
                const pct = total > 0 ? (count / total) * 100 : 0;
                const info = tierInfo[t];
                return (
                  <div key={t}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className={`text-xs tracking-luxury ${info.color}`}>{info.en.toUpperCase()}</span>
                      <span className="font-serif-en text-xs">
                        {count} <span className="text-[10px] text-muted-foreground">({pct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-1 bg-secondary/60 relative">
                      <div className="absolute top-0 left-0 h-1 bg-gold transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground pt-3 leading-relaxed">
                ¥30万 or 30回 = プラチナ ／ ¥15万 or 15回 = ゴールド ／ ¥5万 or 5回 = シルバー
              </p>
            </div>
          )}
        </div>
      </section>
    </AppLayout>
  );
};

// --------------- 小コンポーネント ---------------
const ActionCard = ({
  icon, title, value, unit, description, cta, to, urgent,
}: {
  icon: React.ReactNode; title: string; value: number | undefined; unit: string;
  description: string; cta: string; to: string; urgent: boolean;
}) => (
  <div className={`bg-card p-6 flex flex-col transition-all hover:bg-secondary/40 ${urgent ? "relative" : ""}`}>
    {urgent && <div className="absolute top-0 left-0 w-full h-px bg-gold" />}
    <div className="flex items-center gap-2 mb-4 text-muted-foreground">
      <span className={urgent ? "text-gold" : ""}>{icon}</span>
      <span className="eyebrow text-[10px]">{title}</span>
    </div>
    {value === undefined ? (
      <Skeleton className="h-10 w-16 mb-3" />
    ) : (
      <div className={`display text-4xl mb-2 ${urgent ? "text-gold" : ""}`}>
        {value.toLocaleString()}<span className="text-xs text-muted-foreground ml-1">{unit}</span>
      </div>
    )}
    <p className="text-[11px] text-muted-foreground leading-relaxed mb-4 flex-1">{description}</p>
    <Link to={to}>
      <Button variant="ghost" size="sm" className="w-full justify-between rounded-none text-xs hover:text-gold px-0">
        {cta}
        <ArrowRight className="w-3 h-3" />
      </Button>
    </Link>
  </div>
);

const SummaryRow = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="flex items-center justify-between py-3 border-b border-border/50">
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <span className="font-serif text-xs">{label}</span>
    </div>
    <span className="display text-base">{value}</span>
  </div>
);

export default Dashboard;
