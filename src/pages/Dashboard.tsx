import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { calculateVipTier, tierInfo, type VipTier } from "@/lib/vip";

interface Stats {
  totalCustomers: number;
  dormantCustomers: number;
  atRiskCustomers: number;
  monthlyBookings: number;
  totalCampaigns: number;
  birthdayThisMonth: number;
  monthlyRevenue: number;
  campaignBookings: number;
  vipDistribution: Record<VipTier, number>;
}

const Dashboard = () => {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = async () => {
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthStart = startOfMonth.toISOString().split("T")[0];
      const currentMonth = today.getMonth() + 1; // 1-12

      const dormantCutoff = new Date(); dormantCutoff.setDate(dormantCutoff.getDate() - 180);
      const atRiskCutoff = new Date();  atRiskCutoff.setDate(atRiskCutoff.getDate() - 90);

      const [allCust, dormant, atRisk, bookings, campaigns, allCustomersData, monthRevenue, campaignBookings] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("customers").select("id", { count: "exact", head: true })
          .lt("last_visit_date", dormantCutoff.toISOString().split("T")[0]),
        supabase.from("customers").select("id", { count: "exact", head: true })
          .gte("last_visit_date", dormantCutoff.toISOString().split("T")[0])
          .lt("last_visit_date", atRiskCutoff.toISOString().split("T")[0]),
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .gte("booking_date", monthStart),
        supabase.from("campaigns").select("id", { count: "exact", head: true })
          .eq("status", "sent"),
        supabase.from("customers").select("visit_count, total_spent, birthday").limit(5000),
        supabase.from("bookings").select("revenue").gte("booking_date", monthStart).eq("status", "completed"),
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .not("campaign_id", "is", null)
          .gte("booking_date", monthStart),
      ]);

      const vipDistribution: Record<VipTier, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
      let birthdayCount = 0;
      (allCustomersData.data || []).forEach((c: any) => {
        const t = calculateVipTier(c.visit_count || 0, c.total_spent || 0);
        vipDistribution[t]++;
        if (c.birthday) {
          const m = new Date(c.birthday).getMonth() + 1;
          if (m === currentMonth) birthdayCount++;
        }
      });

      const monthlyRevenue = (monthRevenue.data || []).reduce((s: number, b: any) => s + (b.revenue || 0), 0);

      setStats({
        totalCustomers: allCust.count || 0,
        dormantCustomers: dormant.count || 0,
        atRiskCustomers: atRisk.count || 0,
        monthlyBookings: bookings.count || 0,
        totalCampaigns: campaigns.count || 0,
        birthdayThisMonth: birthdayCount,
        monthlyRevenue,
        campaignBookings: campaignBookings.count || 0,
        vipDistribution,
      });
    };
    load();
  }, []);

  const cards = [
    { num: "i",   label: "顧客総数",   en: "Total Guests", value: stats?.totalCustomers, desc: "登録された大切な資産" },
    { num: "ii",  label: "休眠客",     en: "Dormant",      value: stats?.dormantCustomers, desc: "180日以上、再会を待つお客様", accent: true },
    { num: "iii", label: "離脱予備軍", en: "At Risk",      value: stats?.atRiskCustomers, desc: "90〜180日、心が離れる前に" },
    { num: "iv",  label: "今月の予約", en: "Bookings",     value: stats?.monthlyBookings, desc: "本月迎える再会の数" },
    { num: "v",   label: "今月誕生月", en: "Birthdays",    value: stats?.birthdayThisMonth, desc: "毎月1日に自動でクーポン配信", accent: true },
    { num: "vi",  label: "配信履歴",   en: "Outreach",     value: stats?.totalCampaigns, desc: "これまで届けた言葉の数" },
  ];

  const totalVips = stats ? Object.values(stats.vipDistribution).reduce((a, b) => a + b, 0) : 0;
  const tiers: VipTier[] = ["platinum", "gold", "silver", "bronze"];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.01 — Overview"
        title="ダッシュボード"
        description="サロンの現状を、静かに見つめる時間を。"
      />

      {stats?.totalCustomers === 0 && (
        <Card className="mb-10 border-gold/40 rounded-none shadow-soft">
          <CardContent className="p-8">
            <p className="eyebrow mb-3 text-gold">— First Step —</p>
            <h3 className="display text-2xl mb-3">まずは、お客様を迎え入れましょう</h3>
            <p className="text-sm text-muted-foreground leading-loose">
              左のメニュー「インポート」からExcel/CSVファイルをアップロードして、<br />
              眠れる資産を呼び覚ます最初の一歩を踏み出してください。
            </p>
          </CardContent>
        </Card>
      )}

      {/* メインKPIカード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border mb-16">
        {cards.map(({ num, label, en, value, desc, accent }) => (
          <div key={label} className={`bg-card p-10 transition-all hover:bg-secondary/40 ${accent ? "relative" : ""}`}>
            {accent && <div className="absolute top-0 left-0 w-full h-px bg-gold" />}
            <div className="flex items-baseline justify-between mb-6">
              <span className="font-serif-en italic text-2xl text-gold/70">{num}.</span>
              <span className="eyebrow text-[10px]">{en}</span>
            </div>
            <div className="font-serif text-sm text-muted-foreground mb-3 tracking-wider">{label}</div>
            {value === undefined ? (
              <Skeleton className="h-12 w-24" />
            ) : (
              <div className="display text-5xl mb-4">{value.toLocaleString()}</div>
            )}
            <div className="hairline mb-3" />
            <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* 売上＆配信ROI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
        <div className="border-t border-border pt-10">
          <p className="eyebrow mb-3 text-gold">— Monthly Performance —</p>
          <h3 className="display text-2xl mb-8">今月の数字</h3>
          <div className="space-y-6">
            <div className="flex items-end justify-between border-b border-border pb-4">
              <span className="font-serif text-sm">売上（来店済み）</span>
              <span className="display text-3xl">¥{stats?.monthlyRevenue.toLocaleString() ?? "—"}</span>
            </div>
            <div className="flex items-end justify-between border-b border-border pb-4">
              <span className="font-serif text-sm">配信経由の予約</span>
              <span className="display text-3xl">{stats?.campaignBookings ?? "—"}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed pt-2">
              配信経由の予約は、メール内のクーポンリンクから入った予約数です。<br />
              来店時に金額を入力すると、本物のROIが見えるようになります。
            </p>
          </div>
        </div>

        {/* VIP分布 */}
        <div className="border-t border-border pt-10">
          <p className="eyebrow mb-3 text-gold">— VIP Tier —</p>
          <h3 className="display text-2xl mb-8">お客様のランク</h3>
          <div className="space-y-5">
            {tiers.map(t => {
              const info = tierInfo[t];
              const count = stats?.vipDistribution[t] ?? 0;
              const pct = totalVips > 0 ? (count / totalVips) * 100 : 0;
              return (
                <div key={t}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className={`text-xs tracking-luxury ${info.color}`}>{info.en.toUpperCase()}</span>
                    <span className="font-serif-en text-sm">{count} <span className="text-[10px] text-muted-foreground">({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div className="h-px bg-border relative">
                    <div className="absolute top-0 left-0 h-px bg-gold transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pt-6">
            ¥30万以上 or 30回 = プラチナ／¥15万 or 15回 = ゴールド／¥5万 or 5回 = シルバー
          </p>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
