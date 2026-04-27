import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Stats {
  totalCustomers: number;
  dormantCustomers: number;
  atRiskCustomers: number;
  monthlyBookings: number;
  totalCampaigns: number;
}

const Dashboard = () => {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      const monthStart = startOfMonth.toISOString().split("T")[0];

      const dormantCutoff = new Date();
      dormantCutoff.setDate(dormantCutoff.getDate() - 180);
      const atRiskCutoff = new Date();
      atRiskCutoff.setDate(atRiskCutoff.getDate() - 90);

      const [allCust, dormant, atRisk, bookings, campaigns] = await Promise.all([
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
      ]);

      setStats({
        totalCustomers: allCust.count || 0,
        dormantCustomers: dormant.count || 0,
        atRiskCustomers: atRisk.count || 0,
        monthlyBookings: bookings.count || 0,
        totalCampaigns: campaigns.count || 0,
      });
    };
    load();
  }, []);

  const cards = [
    { num: "i", label: "顧客総数", en: "Total Guests", value: stats?.totalCustomers, desc: "登録された大切な資産" },
    { num: "ii", label: "休眠客", en: "Dormant", value: stats?.dormantCustomers, desc: "180日以上、再会を待つお客様", accent: true },
    { num: "iii", label: "離脱予備軍", en: "At Risk", value: stats?.atRiskCustomers, desc: "90〜180日、心が離れる前に" },
    { num: "iv", label: "今月の予約", en: "Bookings", value: stats?.monthlyBookings, desc: "本月迎える再会の数" },
    { num: "v", label: "配信履歴", en: "Outreach", value: stats?.totalCampaigns, desc: "これまで届けた言葉の数" },
  ];

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
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
    </AppLayout>
  );
};

export default Dashboard;
