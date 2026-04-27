import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2 } from "lucide-react";

interface Customer {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
}

const segmentOf = (lastVisit: string | null): "active" | "at_risk" | "dormant" | "new" => {
  if (!lastVisit) return "new";
  const days = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 90) return "active";
  if (days <= 180) return "at_risk";
  return "dormant";
};

const segmentLabel: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "アクティブ", variant: "default" },
  at_risk: { label: "離脱予備軍", variant: "secondary" },
  dormant: { label: "休眠", variant: "destructive" },
  new: { label: "新規", variant: "outline" },
};

const Customers = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<string>("all");

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, full_name, email, phone, last_visit_date, visit_count, total_spent")
        .order("last_visit_date", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (!error && data) setCustomers(data);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    return customers.filter(c => {
      const segment = segmentOf(c.last_visit_date);
      if (segmentFilter !== "all" && segment !== segmentFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return c.full_name.toLowerCase().includes(s) ||
               (c.email?.toLowerCase().includes(s) ?? false) ||
               (c.phone?.includes(s) ?? false);
      }
      return true;
    });
  }, [customers, search, segmentFilter]);

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">顧客一覧</h1>
        <p className="text-muted-foreground">{customers.length}名の顧客が登録されています</p>
      </div>

      <Card className="p-4 mb-6 shadow-soft">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="氏名・メール・電話で検索" value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Select value={segmentFilter} onValueChange={setSegmentFilter}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべてのセグメント</SelectItem>
              <SelectItem value="active">アクティブ</SelectItem>
              <SelectItem value="at_risk">離脱予備軍</SelectItem>
              <SelectItem value="dormant">休眠</SelectItem>
              <SelectItem value="new">新規</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="shadow-soft">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            該当する顧客が見つかりません
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>氏名</TableHead>
                <TableHead>連絡先</TableHead>
                <TableHead>最終来店</TableHead>
                <TableHead>来店回数</TableHead>
                <TableHead>累計金額</TableHead>
                <TableHead>セグメント</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map(c => {
                const seg = segmentOf(c.last_visit_date);
                const segInfo = segmentLabel[seg];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.full_name}</TableCell>
                    <TableCell className="text-sm">
                      <div>{c.email || "-"}</div>
                      <div className="text-muted-foreground">{c.phone || "-"}</div>
                    </TableCell>
                    <TableCell>{c.last_visit_date || "未来店"}</TableCell>
                    <TableCell>{c.visit_count}回</TableCell>
                    <TableCell>¥{c.total_spent.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={segInfo.variant}>{segInfo.label}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {filtered.length > 200 && (
          <div className="p-4 text-center text-sm text-muted-foreground border-t">
            上位200件を表示しています（全{filtered.length}件）
          </div>
        )}
      </Card>
    </AppLayout>
  );
};

export default Customers;
