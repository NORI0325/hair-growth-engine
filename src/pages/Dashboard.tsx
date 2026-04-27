import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserX, Calendar, Megaphone, TrendingUp } from "lucide-react";
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
      const today = new Date().toISOString().split("T")[0];
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
    { title: "顧客総数", value: stats?.totalCustomers, icon: Users, color: "text-primary", desc: "登録された顧客の合計" },
    { title: "休眠客", value: stats?.dormantCustomers, icon: UserX, color: "text-destructive", desc: "180日以上来店なし - 掘り起こし対象" },
    { title: "離脱予備軍", value: stats?.atRiskCustomers, icon: TrendingUp, color: "text-warning", desc: "90〜180日未来店 - 早期アプローチ推奨" },
    { title: "今月の予約", value: stats?.monthlyBookings, icon: Calendar, color: "text-success", desc: "今月入った予約件数" },
    { title: "配信済キャンペーン", value: stats?.totalCampaigns, icon: Megaphone, color: "text-accent", desc: "これまで配信したキャンペーン" },
  ];

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">ダッシュボード</h1>
        <p className="text-muted-foreground">サロンの現状を一目で確認できます</p>
      </div>

      {stats?.totalCustomers === 0 && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <h3 className="font-bold mb-2">まずは顧客データをインポートしましょう</h3>
            <p className="text-sm text-muted-foreground">
              サイドバーの「顧客インポート」からExcel/CSVファイルをアップロードして始めましょう。
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ title, value, icon: Icon, color, desc }) => (
          <Card key={title} className="shadow-soft">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <Icon className={`w-5 h-5 ${color}`} />
            </CardHeader>
            <CardContent>
              {value === undefined ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <div className="text-3xl font-bold">{value.toLocaleString()}</div>
              )}
              <p className="text-xs text-muted-foreground mt-2">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
