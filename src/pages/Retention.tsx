import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RotateCcw, Users, TrendingUp } from "lucide-react";

interface StaffRepeat { staff_id: string; name: string; total: number; repeated: number; rate: number }

const Retention = () => {
  const locationId = useCurrentLocationId();
  const [loading, setLoading] = useState(true);
  const [overallSecondVisit, setOverallSecondVisit] = useState({ total: 0, repeated: 0 });
  const [overall90Day, setOverall90Day] = useState({ total: 0, repeated: 0 });
  const [byStaff, setByStaff] = useState<StaffRepeat[]>([]);

  useEffect(() => {
    if (!locationId) return;
    (async () => {
      setLoading(true);

      // 過去1年の予約を staff/customer/date で取得
      const since = new Date();
      since.setFullYear(since.getFullYear() - 1);
      const sinceStr = since.toISOString().slice(0, 10);

      const { data: bookings } = await supabase
        .from("bookings")
        .select("customer_id, staff_id, booking_date")
        .eq("location_id", locationId)
        .gte("booking_date", sinceStr)
        .in("status", ["confirmed", "completed"])
        .order("booking_date", { ascending: true })
        .limit(5000);

      // 顧客別予約日リスト
      const byCustomer: Record<string, string[]> = {};
      const firstStaff: Record<string, string | null> = {};
      (bookings || []).forEach((b: any) => {
        if (!b.customer_id) return;
        byCustomer[b.customer_id] = byCustomer[b.customer_id] || [];
        byCustomer[b.customer_id].push(b.booking_date);
        if (!(b.customer_id in firstStaff)) firstStaff[b.customer_id] = b.staff_id || null;
      });

      // 新規→2回目転換率（1年以内に2回以上来た人/初回来た人）
      const newCustomers = Object.entries(byCustomer);
      const repeated2nd = newCustomers.filter(([, dates]) => dates.length >= 2).length;
      setOverallSecondVisit({ total: newCustomers.length, repeated: repeated2nd });

      // 90日以内再来率
      const repeated90 = newCustomers.filter(([, dates]) => {
        if (dates.length < 2) return false;
        const first = new Date(dates[0]).getTime();
        const second = new Date(dates[1]).getTime();
        return (second - first) / 86400000 <= 90;
      }).length;
      setOverall90Day({ total: newCustomers.length, repeated: repeated90 });

      // スタッフ別リピート率（初回担当が同じで2回目以降が来た割合）
      const { data: staff } = await supabase.from("staff").select("id, name").eq("location_id", locationId).eq("active", true);
      const staffStats: Record<string, { total: number; repeated: number }> = {};
      (staff || []).forEach((s: any) => { staffStats[s.id] = { total: 0, repeated: 0 }; });
      Object.entries(byCustomer).forEach(([cid, dates]) => {
        const sid = firstStaff[cid];
        if (!sid || !staffStats[sid]) return;
        staffStats[sid].total++;
        if (dates.length >= 2) staffStats[sid].repeated++;
      });
      setByStaff(
        (staff || [])
          .map((s: any) => ({
            staff_id: s.id, name: s.name,
            total: staffStats[s.id].total,
            repeated: staffStats[s.id].repeated,
            rate: staffStats[s.id].total > 0 ? Math.round(staffStats[s.id].repeated / staffStats[s.id].total * 100) : 0,
          }))
          .sort((a, b) => b.rate - a.rate)
      );

      setLoading(false);
    })();
  }, [locationId]);

  const pct = (n: number, d: number) => d > 0 ? Math.round(n / d * 100) : 0;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.11 — Retention"
        title="リピート率ダッシュボード"
        description="新規→2回目転換、90日以内再来、スタッフ別リピート率（過去1年）"
      />
      {loading ? (
        <div className="py-24 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="rounded-none"><CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <RotateCcw className="w-4 h-4 text-gold" />
                <p className="eyebrow text-[10px]">— 2nd Visit Conversion —</p>
              </div>
              <p className="text-3xl font-serif">{pct(overallSecondVisit.repeated, overallSecondVisit.total)}%</p>
              <p className="text-[11px] text-muted-foreground mt-1">{overallSecondVisit.repeated} / {overallSecondVisit.total} 名が2回目以降来店</p>
            </CardContent></Card>
            <Card className="rounded-none"><CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-gold" />
                <p className="eyebrow text-[10px]">— 90 Day Re-visit Rate —</p>
              </div>
              <p className="text-3xl font-serif">{pct(overall90Day.repeated, overall90Day.total)}%</p>
              <p className="text-[11px] text-muted-foreground mt-1">{overall90Day.repeated} / {overall90Day.total} 名が90日以内に再来</p>
            </CardContent></Card>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-gold" />
              <h3 className="font-serif text-sm">スタッフ別リピート率 <span className="eyebrow text-[10px] text-muted-foreground ml-2">By Staff</span></h3>
            </div>
            <div className="border-t border-border">
              <div className="grid grid-cols-12 gap-4 py-3 border-b border-border text-[11px] font-serif text-muted-foreground">
                <div className="col-span-4">スタッフ</div>
                <div className="col-span-3 text-right">担当顧客数</div>
                <div className="col-span-2 text-right">リピート</div>
                <div className="col-span-3 text-right">リピート率</div>
              </div>
              {byStaff.map((s) => (
                <div key={s.staff_id} className="grid grid-cols-12 gap-4 py-3 border-b border-border/40 items-center">
                  <div className="col-span-4 font-serif text-sm">{s.name}</div>
                  <div className="col-span-3 text-right text-xs">{s.total}名</div>
                  <div className="col-span-2 text-right text-xs">{s.repeated}名</div>
                  <div className="col-span-3 text-right">
                    <span className={`font-serif text-base ${s.rate >= 60 ? "text-success" : s.rate >= 40 ? "text-gold" : "text-muted-foreground"}`}>{s.rate}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default Retention;
