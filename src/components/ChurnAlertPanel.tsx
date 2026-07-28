import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import { AlertTriangle, TrendingDown, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface AtRiskCustomer {
  id: string;
  full_name: string;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
  days_since: number;
  isVip: boolean;
}

export const ChurnAlertPanel = () => {
  const locationId = useCurrentLocationId();
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const [list, setList] = useState<AtRiskCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !locationId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase.rpc as any)("churn_risk_customers_v1", {
        _owner_id: tenantId,
        _location_id: locationId,
        _limit: 10,
      });
      if (error) {
        toast.error("離反予兆データを取得できませんでした");
        setList([]);
        setLoading(false);
        return;
      }
      const at: AtRiskCustomer[] = (data || []).map((c: any) => ({
        id: c.id,
        full_name: c.full_name,
        last_visit_date: c.last_visit_date,
        visit_count: Number(c.visit_count || 0),
        total_spent: Number(c.total_spent || 0),
        days_since: Number(c.days_since || 0),
        isVip: Boolean(c.is_vip),
      }));
      setList(at);
      setLoading(false);
    })();
  }, [tenantId, locationId]);

  if (loading || list.length === 0) return null;

  return (
    <div className="border border-warning/40 bg-warning/5 p-5 rounded-none mb-8">
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-4 h-4 text-warning" />
        <h3 className="font-serif text-sm">離反予兆アラート <span className="eyebrow text-[10px] text-muted-foreground ml-2">Churn Risk</span></h3>
        <span className="text-[10px] text-muted-foreground ml-auto">{list.length}名のフォローが必要です</span>
      </div>
      <div className="space-y-2">
        {list.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {c.isVip && <Crown className="w-3 h-3 text-gold shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-serif truncate">{c.full_name}</div>
                <div className="text-[10px] text-muted-foreground">
                  最終{c.days_since}日前 / 来店{c.visit_count}回 / ¥{c.total_spent.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {c.days_since >= 180 && (
                <span className="text-[10px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />要緊急
                </span>
              )}
              <Button size="sm" variant="ghost" onClick={() => navigate(`/customers/${c.id}/chart`)} className="h-7 text-[10px] rounded-none">
                カルテ確認
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChurnAlertPanel;
