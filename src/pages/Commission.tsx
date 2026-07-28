import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Save, JapaneseYen, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";

interface Staff { id: string; name: string }
interface Rule {
  id?: string;
  staff_id: string;
  base_salary: number;
  nominated_tech_rate: number;
  free_tech_rate: number;
  retail_rate: number;
  monthly_target: number;
  target_bonus: number;
}

interface MonthlyResult {
  staff_id: string;
  name: string;
  nominated_revenue: number;
  free_revenue: number;
  total_revenue: number;
  bookings_count: number;
  unique_customers: number;
  commission: number;
  base: number;
  bonus: number;
  total_pay: number;
  achievement: number;
}

const Commission = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [results, setResults] = useState<MonthlyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    if (!tenantId || !locationId) return;
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: r }] = await Promise.all([
        supabase.from("staff").select("id, name").eq("location_id", locationId).eq("active", true).order("sort_order"),
        supabase.from("staff_commission_rules").select("*").eq("owner_id", tenantId),
      ]);
      setStaff(s || []);
      const map: Record<string, Rule> = {};
      (r || []).forEach((rule: any) => { map[rule.staff_id] = rule; });
      // 未設定スタッフはデフォルト
      (s || []).forEach((st) => {
        if (!map[st.id]) {
          map[st.id] = {
            staff_id: st.id, base_salary: 200000,
            nominated_tech_rate: 50, free_tech_rate: 30, retail_rate: 10,
            monthly_target: 800000, target_bonus: 30000,
          };
        }
      });
      setRules(map);
      setLoading(false);
    })();
  }, [tenantId, locationId]);

  // 月次集計
  useEffect(() => {
    if (!locationId || staff.length === 0) return;
    (async () => {
      const start = `${month}-01`;
      const next = new Date(`${month}-01`);
      next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);

      const { data: bookings } = await supabase
        .from("bookings")
        .select("staff_id, customer_id, total_price, revenue, is_nominated, status")
        .eq("location_id", locationId)
        .gte("booking_date", start)
        .lt("booking_date", end)
        .in("status", ["confirmed", "completed"]);

      const byStaff: Record<string, MonthlyResult> = {};
      staff.forEach((s) => {
        byStaff[s.id] = {
          staff_id: s.id, name: s.name,
          nominated_revenue: 0, free_revenue: 0, total_revenue: 0,
          bookings_count: 0, unique_customers: 0,
          commission: 0, base: 0, bonus: 0, total_pay: 0, achievement: 0,
        };
      });
      const customerSet: Record<string, Set<string>> = {};
      (bookings || []).forEach((b: any) => {
        if (!b.staff_id || !byStaff[b.staff_id]) return;
        const r = byStaff[b.staff_id];
        const rev = b.total_price || b.revenue || 0;
        r.bookings_count++;
        r.total_revenue += rev;
        if (b.is_nominated) r.nominated_revenue += rev;
        else r.free_revenue += rev;
        customerSet[b.staff_id] = customerSet[b.staff_id] || new Set();
        if (b.customer_id) customerSet[b.staff_id].add(b.customer_id);
      });
      Object.values(byStaff).forEach((r) => {
        const rule = rules[r.staff_id];
        if (rule) {
          r.commission = Math.round(
            (r.nominated_revenue * rule.nominated_tech_rate / 100) +
            (r.free_revenue * rule.free_tech_rate / 100)
          );
          r.base = rule.base_salary;
          r.achievement = rule.monthly_target > 0 ? Math.round(r.total_revenue / rule.monthly_target * 100) : 0;
          r.bonus = r.achievement >= 100 ? rule.target_bonus : 0;
          r.total_pay = r.base + r.commission + r.bonus;
        }
        r.unique_customers = (customerSet[r.staff_id] || new Set()).size;
      });
      setResults(Object.values(byStaff).sort((a, b) => b.total_revenue - a.total_revenue));
    })();
  }, [month, staff, rules, locationId]);

  const saveRule = async (staffId: string) => {
    if (!user) return;
    const rule = rules[staffId];
    if (!rule) return;
    setSaving(staffId);
    if (!tenantId) return;
    const payload = { ...rule, owner_id: tenantId, location_id: locationId };
    const { error } = await supabase.from("staff_commission_rules").upsert(payload, { onConflict: "staff_id" });
    setSaving(null);
    if (error) { toast.error("保存失敗: " + error.message); return; }
    toast.success("保存しました");
  };

  const updateRule = (staffId: string, key: keyof Rule, value: number) => {
    setRules({ ...rules, [staffId]: { ...rules[staffId], [key]: value } });
  };

  const totalRevenue = useMemo(() => results.reduce((a, b) => a + b.total_revenue, 0), [results]);
  const totalPay = useMemo(() => results.reduce((a, b) => a + b.total_pay, 0), [results]);

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.10 — Commission"
        title="スタッフ歩合・売上"
        description="指名売上・歩合率・月次自動計算"
      />

      <div className="flex items-center gap-4 mb-6">
        <Label className="text-xs">対象月:</Label>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-none w-40 h-9 text-xs" />
      </div>

      {loading ? (
        <div className="py-24 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
      ) : (
        <>
          {/* 月次サマリー */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <Card className="rounded-none"><CardContent className="p-4">
              <p className="eyebrow text-[10px] mb-1">— Total Revenue —</p>
              <p className="text-2xl font-serif">¥{totalRevenue.toLocaleString()}</p>
            </CardContent></Card>
            <Card className="rounded-none"><CardContent className="p-4">
              <p className="eyebrow text-[10px] mb-1">— Total Payroll —</p>
              <p className="text-2xl font-serif">¥{totalPay.toLocaleString()}</p>
            </CardContent></Card>
            <Card className="rounded-none"><CardContent className="p-4">
              <p className="eyebrow text-[10px] mb-1">— Payroll Ratio —</p>
              <p className="text-2xl font-serif">{totalRevenue > 0 ? Math.round(totalPay / totalRevenue * 100) : 0}%</p>
            </CardContent></Card>
          </div>

          {/* スタッフ別 */}
          <div className="space-y-4">
            {results.map((r) => {
              const rule = rules[r.staff_id];
              return (
                <Card key={r.staff_id} className="rounded-none">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-serif text-base">{r.name}</h3>
                        <p className="text-[11px] text-muted-foreground">
                          指名 ¥{r.nominated_revenue.toLocaleString()} / フリー ¥{r.free_revenue.toLocaleString()} / {r.bookings_count}件・{r.unique_customers}名
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-serif">¥{r.total_pay.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground">支給予定額</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-[11px] py-2 border-y border-border/40">
                      <div><span className="text-muted-foreground">基本給:</span> ¥{r.base.toLocaleString()}</div>
                      <div><span className="text-muted-foreground">歩合:</span> ¥{r.commission.toLocaleString()}</div>
                      <div><span className="text-muted-foreground">達成度:</span> {r.achievement}%</div>
                      <div><span className="text-muted-foreground">賞与:</span> ¥{r.bonus.toLocaleString()}</div>
                    </div>

                    {rule && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gold">歩合ルール設定</summary>
                        <div className="grid grid-cols-3 gap-3 mt-3">
                          <div>
                            <Label className="text-[10px]">基本給(¥)</Label>
                            <Input type="number" value={rule.base_salary} onChange={(e) => updateRule(r.staff_id, "base_salary", Number(e.target.value))} className="rounded-none h-8 text-xs" />
                          </div>
                          <div>
                            <Label className="text-[10px]">指名歩合(%)</Label>
                            <Input type="number" step="0.1" value={rule.nominated_tech_rate} onChange={(e) => updateRule(r.staff_id, "nominated_tech_rate", Number(e.target.value))} className="rounded-none h-8 text-xs" />
                          </div>
                          <div>
                            <Label className="text-[10px]">フリー歩合(%)</Label>
                            <Input type="number" step="0.1" value={rule.free_tech_rate} onChange={(e) => updateRule(r.staff_id, "free_tech_rate", Number(e.target.value))} className="rounded-none h-8 text-xs" />
                          </div>
                          <div>
                            <Label className="text-[10px]">月次目標(¥)</Label>
                            <Input type="number" value={rule.monthly_target} onChange={(e) => updateRule(r.staff_id, "monthly_target", Number(e.target.value))} className="rounded-none h-8 text-xs" />
                          </div>
                          <div>
                            <Label className="text-[10px]">達成賞与(¥)</Label>
                            <Input type="number" value={rule.target_bonus} onChange={(e) => updateRule(r.staff_id, "target_bonus", Number(e.target.value))} className="rounded-none h-8 text-xs" />
                          </div>
                          <div className="flex items-end">
                            <Button size="sm" onClick={() => saveRule(r.staff_id)} disabled={saving === r.staff_id} className="rounded-none w-full">
                              {saving === r.staff_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Save className="w-3 h-3 mr-1" />保存</>}
                            </Button>
                          </div>
                        </div>
                      </details>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </AppLayout>
  );
};

export default Commission;
