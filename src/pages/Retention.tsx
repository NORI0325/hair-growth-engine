import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RotateCcw, Users, TrendingUp } from "lucide-react";
import { toast } from "sonner";

interface StaffRepeat { staff_id: string; name: string; total: number; repeated: number; rate: number }
interface RetentionMetrics {
  overall_second_visit?: { total?: number | string; repeated?: number | string };
  overall_90_day?: { total?: number | string; repeated?: number | string };
  by_staff?: Array<{
    staff_id?: string;
    name?: string;
    total?: number | string;
    repeated?: number | string;
    rate?: number | string;
  }>;
}
type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;
const callRetentionRpc = (args: Record<string, unknown>): RpcResult =>
  (supabase.rpc as unknown as (fn: string, params: Record<string, unknown>) => RpcResult)("retention_metrics_v1", args);

const Retention = () => {
  const locationId = useCurrentLocationId();
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [overallSecondVisit, setOverallSecondVisit] = useState({ total: 0, repeated: 0 });
  const [overall90Day, setOverall90Day] = useState({ total: 0, repeated: 0 });
  const [byStaff, setByStaff] = useState<StaffRepeat[]>([]);

  useEffect(() => {
    if (!tenantId || !locationId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await callRetentionRpc({
        _owner_id: tenantId,
        _location_id: locationId,
      });
      if (error) {
        toast.error("リピート率データを取得できませんでした");
        setLoading(false);
        return;
      }
      const metrics = (data || {}) as RetentionMetrics;
      setOverallSecondVisit({
        total: Number(metrics.overall_second_visit?.total || 0),
        repeated: Number(metrics.overall_second_visit?.repeated || 0),
      });
      setOverall90Day({
        total: Number(metrics.overall_90_day?.total || 0),
        repeated: Number(metrics.overall_90_day?.repeated || 0),
      });
      setByStaff((metrics.by_staff || []).map((row) => ({
        staff_id: row.staff_id || "unknown",
        name: row.name || "未設定",
        total: Number(row.total || 0),
        repeated: Number(row.repeated || 0),
        rate: Number(row.rate || 0),
      })));

      setLoading(false);
    })();
  }, [tenantId, locationId]);

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
