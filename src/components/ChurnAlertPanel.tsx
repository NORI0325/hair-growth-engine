import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { AlertTriangle, TrendingDown, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calculateVipTier } from "@/lib/vip";

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
  const navigate = useNavigate();
  const [list, setList] = useState<AtRiskCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, last_visit_date, visit_count, total_spent")
        .eq("location_id", locationId)
        .eq("opt_out_automation", false)
        .gte("visit_count", 2) // 2回以上来てた人が対象
        .not("last_visit_date", "is", null)
        .order("total_spent", { ascending: false })
        .limit(500);
      const now = Date.now();
      const at: AtRiskCustomer[] = (data || [])
        .map((c: any) => {
          const days = Math.floor((now - new Date(c.last_visit_date).getTime()) / 86400000);
          const tier = calculateVipTier(c.visit_count, c.total_spent);
          const isVip = tier === "platinum" || tier === "gold";
          return { ...c, days_since: days, isVip };
        })
        .filter((c) => c.days_since >= 90 && c.days_since <= 365)
        .sort((a, b) => {
          // VIP優先、次に売上、次に経過日数
          if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
          if (b.total_spent !== a.total_spent) return b.total_spent - a.total_spent;
          return a.days_since - b.days_since;
        })
        .slice(0, 10);
      setList(at);
      setLoading(false);
    })();
  }, [locationId]);

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
