import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import CustomerChartPanel from "@/components/CustomerChartPanel";
import TreatmentHistoryPanel from "@/components/TreatmentHistoryPanel";
import { CustomerInsightsPanel } from "@/components/CustomerInsightsPanel";
import { Loader2, ArrowLeft } from "lucide-react";

interface Customer { id: string; full_name: string; email: string | null; phone: string | null; visit_count: number; total_spent: number }

const CustomerChart = () => {
  const { customerId } = useParams<{ customerId: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customerId) return;
    (async () => {
      const { data } = await supabase.from("customers").select("id, full_name, email, phone, visit_count, total_spent").eq("id", customerId).maybeSingle();
      setCustomer(data as any);
      setLoading(false);
    })();
  }, [customerId]);

  if (loading) return <AppLayout><div className="py-24 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></AppLayout>;
  if (!customer) return <AppLayout><div className="py-24 text-center text-muted-foreground">顧客が見つかりません</div></AppLayout>;

  return (
    <AppLayout>
      <Link to="/customers" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-gold mb-4">
        <ArrowLeft className="w-3 h-3" /> 顧客一覧へ
      </Link>
      <PageHeader
        eyebrow="— Guest Chart —"
        title={customer.full_name}
        description={`来店${customer.visit_count}回 / ¥${customer.total_spent.toLocaleString()}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-8">
        <div className="space-y-10">
          <CustomerChartPanel customerId={customer.id} />
        </div>
        <div className="space-y-10">
          <TreatmentHistoryPanel customerId={customer.id} />
          <div className="border-t border-border pt-6">
            <CustomerInsightsPanel customerId={customer.id} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default CustomerChart;
