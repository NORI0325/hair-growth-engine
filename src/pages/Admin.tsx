import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Navigate } from "react-router-dom";

interface TenantStat {
  owner_id: string;
  salon_name: string;
  status: string;
  trial_ends_at: string | null;
  created_at: string;
  customer_count: number;
  booking_count: number;
  location_count: number;
}

const Admin = () => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [stats, setStats] = useState<TenantStat[]>([]);
  const [mrr, setMrr] = useState(0);
  const [totalLocations, setTotalLocations] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
      setIsAdmin(!!data);
    })();
  }, [user]);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("owner_id, status, trial_ends_at, profiles!inner(salon_name, created_at)");
      const tenants: TenantStat[] = [];
      let activeMrr = 0;
      let locTotal = 0;
      for (const s of (subs as any) ?? []) {
        const [{ count: cc }, { count: bc }, { count: lc }] = await Promise.all([
          supabase.from("customers").select("*", { count: "exact", head: true }).eq("owner_id", s.owner_id),
          supabase.from("bookings").select("*", { count: "exact", head: true }).eq("owner_id", s.owner_id),
          supabase.from("locations").select("*", { count: "exact", head: true }).eq("tenant_id", s.owner_id),
        ]);
        const locCount = lc ?? 0;
        // 1店舗目: ¥9,800、2店舗目以降: ¥7,800
        if (s.status === "active") activeMrr += 9800 + Math.max(0, locCount - 1) * 7800;
        locTotal += locCount;
        tenants.push({
          owner_id: s.owner_id, salon_name: s.profiles?.salon_name ?? "—",
          status: s.status, trial_ends_at: s.trial_ends_at,
          created_at: s.profiles?.created_at ?? "",
          customer_count: cc ?? 0, booking_count: bc ?? 0,
          location_count: locCount,
        });
      }
      setStats(tenants);
      setMrr(activeMrr);
      setTotalLocations(locTotal);
    })();
  }, [isAdmin]);

  if (isAdmin === null) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold">運営管理</h1>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4"><p className="text-sm text-muted-foreground">MRR</p><p className="text-2xl font-bold">¥{mrr.toLocaleString()}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">総テナント</p><p className="text-2xl font-bold">{stats.length}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">有料</p><p className="text-2xl font-bold">{stats.filter(s => s.status === "active").length}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">トライアル中</p><p className="text-2xl font-bold">{stats.filter(s => s.status === "trialing").length}</p></Card>
        </div>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">全テナント</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="pb-2">サロン名</th><th className="pb-2">状態</th><th className="pb-2">登録日</th><th className="pb-2">顧客</th><th className="pb-2">予約</th></tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.owner_id} className="border-b">
                    <td className="py-2">{s.salon_name}</td>
                    <td><Badge>{s.status}</Badge></td>
                    <td>{s.created_at ? new Date(s.created_at).toLocaleDateString("ja-JP") : "-"}</td>
                    <td>{s.customer_count}</td>
                    <td>{s.booking_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Admin;
