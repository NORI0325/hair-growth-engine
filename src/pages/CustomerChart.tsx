import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import CustomerChartPanel from "@/components/CustomerChartPanel";
import TreatmentHistoryPanel from "@/components/TreatmentHistoryPanel";
import { CustomerInsightsPanel } from "@/components/CustomerInsightsPanel";
import StaffSwitcher from "@/components/StaffSwitcher";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, AlertTriangle } from "lucide-react";

interface Customer { id: string; full_name: string; email: string | null; phone: string | null; visit_count: number; total_spent: number }
interface ChartAlert { has_diamine_allergy: boolean; is_pregnant: boolean; allergies: string | null }

const CustomerChart = () => {
  const { customerId } = useParams<{ customerId: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [alert, setAlert] = useState<ChartAlert | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customerId) return;
    (async () => {
      const [c, ch] = await Promise.all([
        supabase.from("customers").select("id, full_name, email, phone, visit_count, total_spent").eq("id", customerId).maybeSingle(),
        supabase.from("customer_charts").select("has_diamine_allergy, is_pregnant, allergies").eq("customer_id", customerId).maybeSingle(),
      ]);
      setCustomer(c.data as any);
      setAlert(ch.data as any);
      setLoading(false);
    })();
  }, [customerId]);

  if (loading) return <AppLayout><div className="py-24 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></AppLayout>;
  if (!customer) return <AppLayout><div className="py-24 text-center text-muted-foreground">顧客が見つかりません</div></AppLayout>;

  const hasAlert = alert && (alert.has_diamine_allergy || alert.is_pregnant || (alert.allergies && alert.allergies.trim()));

  return (
    <AppLayout>
      {/* スティッキーヘッダー（モバイル運用最適化） */}
      <div className="sticky top-0 z-30 -mx-4 md:-mx-12 px-4 md:px-12 py-3 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <Link to="/customers" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-gold shrink-0">
            <ArrowLeft className="w-3 h-3" />一覧
          </Link>
          <div className="flex-1 min-w-0 text-center">
            <div className="font-serif text-base truncate">{customer.full_name}</div>
            <div className="text-[10px] text-muted-foreground">来店{customer.visit_count}回 / ¥{customer.total_spent.toLocaleString()}</div>
          </div>
          <StaffSwitcher />
        </div>

        {/* 重要アラート常時最上部固定 */}
        {hasAlert && (
          <div className="mt-2 border border-destructive/40 bg-destructive/10 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-[11px] text-destructive space-y-0.5">
              {alert!.has_diamine_allergy && <div>⚠️ ジアミンアレルギー（カラー要パッチテスト）</div>}
              {alert!.is_pregnant && <div>⚠️ 妊娠中</div>}
              {alert!.allergies && <div>⚠️ {alert!.allergies}</div>}
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="treatments" className="mt-4">
        <TabsList className="w-full grid grid-cols-3 rounded-none h-auto p-0 bg-transparent border-b border-border">
          <TabsTrigger value="treatments" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-gold data-[state=active]:shadow-none py-3 text-xs">
            施術履歴
          </TabsTrigger>
          <TabsTrigger value="chart" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-gold data-[state=active]:shadow-none py-3 text-xs">
            カルテ
          </TabsTrigger>
          <TabsTrigger value="insights" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-gold data-[state=active]:shadow-none py-3 text-xs">
            分析
          </TabsTrigger>
        </TabsList>

        <TabsContent value="treatments" className="mt-6">
          <TreatmentHistoryPanel customerId={customer.id} />
        </TabsContent>
        <TabsContent value="chart" className="mt-6">
          <CustomerChartPanel customerId={customer.id} onSaved={() => {
            // refresh alert banner
            supabase.from("customer_charts").select("has_diamine_allergy, is_pregnant, allergies")
              .eq("customer_id", customer.id).maybeSingle().then(({ data }) => setAlert(data as any));
          }} />
        </TabsContent>
        <TabsContent value="insights" className="mt-6">
          <CustomerInsightsPanel customerId={customer.id} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
};

export default CustomerChart;
