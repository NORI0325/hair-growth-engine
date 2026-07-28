import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenant";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { format, addDays, startOfDay, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { TEMPLATE_CATALOG } from "@/lib/templateCatalog";

type Job = {
  id: string;
  job_type: string;
  scheduled_for: string;
  status: string;
  customer_id: string;
  customer_name?: string;
};

const JOB_LABEL: Record<string, string> = {
  thank_you: "サンクス",
  reminder: "リマインダー",
  aftercare: "アフターケア",
  next_suggestion: "次回提案",
  reactivation: "復活",
  birthday: "誕生日",
  review_request: "レビュー依頼",
};

const JOB_COLOR: Record<string, string> = {
  thank_you: "bg-green-500/15 text-green-700 border-green-300",
  reminder: "bg-blue-500/15 text-blue-700 border-blue-300",
  aftercare: "bg-purple-500/15 text-purple-700 border-purple-300",
  next_suggestion: "bg-orange-500/15 text-orange-700 border-orange-300",
  reactivation: "bg-red-500/15 text-red-700 border-red-300",
  birthday: "bg-pink-500/15 text-pink-700 border-pink-300",
  review_request: "bg-yellow-500/15 text-yellow-700 border-yellow-300",
};

const Schedule = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [days, setDays] = useState(14);
  const [filter, setFilter] = useState<string>("all");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !locationId) return;
    setLoading(true);
    const start = new Date().toISOString();
    const end = addDays(new Date(), days).toISOString();
    supabase
      .from("scheduled_jobs")
      .select("id, job_type, scheduled_for, status, customer_id, customers!inner(full_name)")
      .eq("owner_id", tenantId)
      .eq("location_id", locationId)
      .eq("status", "pending")
      .gte("scheduled_for", start)
      .lte("scheduled_for", end)
      .order("scheduled_for")
      .then(({ data }) => {
        setJobs((data || []).map((j: any) => ({
          ...j,
          customer_name: j.customers?.full_name,
        })));
        setLoading(false);
      });
  }, [tenantId, locationId, days]);

  const filtered = useMemo(
    () => filter === "all" ? jobs : jobs.filter((j) => j.job_type === filter),
    [jobs, filter]
  );

  const dayBuckets = useMemo(() => {
    const buckets: Array<{ date: Date; items: Job[] }> = [];
    const start = startOfDay(new Date());
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      buckets.push({
        date: d,
        items: filtered.filter((j) => isSameDay(new Date(j.scheduled_for), d)),
      });
    }
    return buckets;
  }, [filtered, days]);

  const cancelJob = async (id: string) => {
    if (!confirm("この配信をキャンセルしますか？")) return;
    if (!tenantId || !locationId) return;
    await supabase.from("scheduled_jobs").update({ status: "cancelled" })
      .eq("id", id).eq("owner_id", tenantId).eq("location_id", locationId);
    setJobs((j) => j.filter((x) => x.id !== id));
  };

  const totalByType = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach((j) => { m[j.job_type] = (m[j.job_type] || 0) + 1; });
    return m;
  }, [filtered]);

  return (
    <AppLayout>
      <div className="mb-8">
        <div className="eyebrow text-[10px] mb-3">SCHEDULE · 配信予定</div>
        <h1 className="font-serif text-4xl text-foreground">配信スケジュール</h1>
        <p className="text-sm text-muted-foreground mt-2">これから自動で送られるメッセージを一覧</p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7日先まで</SelectItem>
            <SelectItem value="14">14日先まで</SelectItem>
            <SelectItem value="30">30日先まで</SelectItem>
            <SelectItem value="60">60日先まで</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            {Object.entries(JOB_LABEL).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          {Object.entries(totalByType).map(([k, n]) => (
            <Badge key={k} variant="outline" className={JOB_COLOR[k]}>{JOB_LABEL[k] || k}: {n}</Badge>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">読み込み中...</div>
      ) : (
        <div className="space-y-3">
          {dayBuckets.map(({ date, items }) => (
            <Card key={date.toISOString()} className={items.length === 0 ? "opacity-50" : ""}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{format(date, "M月d日 (E)", { locale: ja })}</span>
                  <span className="text-xs text-muted-foreground">{items.length}件</span>
                </CardTitle>
              </CardHeader>
              {items.length > 0 && (
                <CardContent className="pt-0 space-y-2">
                  {items.map((j) => (
                    <div key={j.id} className="flex items-center justify-between p-2 rounded border bg-card">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className={`text-[10px] ${JOB_COLOR[j.job_type] || ""}`}>
                          {JOB_LABEL[j.job_type] || j.job_type}
                        </Badge>
                        <span className="text-sm">{j.customer_name || "—"}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(j.scheduled_for), "HH:mm")}
                        </span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => cancelJob(j.id)}>キャンセル</Button>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
};

export default Schedule;
