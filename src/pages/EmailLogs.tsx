import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Mail, CheckCircle2, XCircle, ShieldOff, Clock } from "lucide-react";
import { toast } from "sonner";

interface LogRow {
  id: string;
  message_id: string | null;
  template_name: string | null;
  recipient_email: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

const STATUS_INFO: Record<string, { label: string; color: string; icon: any }> = {
  sent:       { label: "送信成功",  color: "text-success",      icon: CheckCircle2 },
  pending:    { label: "送信中",    color: "text-muted-foreground", icon: Clock },
  failed:     { label: "失敗",      color: "text-destructive",  icon: XCircle },
  dlq:        { label: "失敗(再試行終了)", color: "text-destructive", icon: XCircle },
  suppressed: { label: "配信停止",  color: "text-warning",      icon: ShieldOff },
  bounced:    { label: "バウンス",  color: "text-destructive",  icon: XCircle },
  complained: { label: "苦情",      color: "text-destructive",  icon: XCircle },
};

const TEMPLATE_LABEL: Record<string, string> = {
  "thank-you": "お礼メール",
  "birthday": "誕生日",
  "review-request": "レビュー依頼",
  "booking-confirmation": "予約確認",
  "auth_emails": "認証メール",
};

const RANGES = [
  { value: "1",  label: "24時間" },
  { value: "7",  label: "7日間" },
  { value: "30", label: "30日間" },
  { value: "90", label: "90日間" },
];

const EMAIL_LOG_PAGE_SIZE = 250;

const EmailLogs = () => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [days, setDays] = useState("7");
  const [tplFilter, setTplFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = async (reset = true) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();
    const offset = reset ? 0 : rows.length;
    const { data, error } = await supabase
      .from("email_send_log" as any)
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(offset, offset + EMAIL_LOG_PAGE_SIZE - 1);
    if (error) {
      toast.error("メール配信ログを取得できませんでした");
    } else {
      const nextRows = ((data as unknown) as LogRow[]) || [];
      setRows(current => reset ? nextRows : [...current, ...nextRows]);
      setHasMore(nextRows.length === EMAIL_LOG_PAGE_SIZE);
    }
    if (reset) setLoading(false); else setLoadingMore(false);
  };

  useEffect(() => { void load(true); }, [days]);

  // メッセージID毎に最新ステータスを取得（重複排除）
  const dedup = useMemo(() => {
    const map = new Map<string, LogRow>();
    for (const r of rows) {
      const key = r.message_id || r.id;
      if (!map.has(key)) map.set(key, r);
    }
    return Array.from(map.values());
  }, [rows]);

  const templates = useMemo(() => {
    return Array.from(new Set(dedup.map(r => r.template_name).filter(Boolean))) as string[];
  }, [dedup]);

  const filtered = useMemo(() => {
    return dedup.filter(r => {
      if (tplFilter !== "all" && r.template_name !== tplFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "failed" && !["failed", "dlq", "bounced", "complained"].includes(r.status)) return false;
        if (statusFilter !== "failed" && r.status !== statusFilter) return false;
      }
      return true;
    });
  }, [dedup, tplFilter, statusFilter]);

  const stats = useMemo(() => {
    const s = { total: filtered.length, sent: 0, failed: 0, suppressed: 0, pending: 0 };
    for (const r of filtered) {
      if (r.status === "sent") s.sent++;
      else if (["failed", "dlq", "bounced", "complained"].includes(r.status)) s.failed++;
      else if (r.status === "suppressed") s.suppressed++;
      else if (r.status === "pending") s.pending++;
    }
    return s;
  }, [filtered]);

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-10 gap-4">
        <PageHeader
          eyebrow="No.08 — Email Logs"
          title="メール配信ログ"
          description="送信したお礼・誕生日・予約確認・キャンペーンメールの配信状況"
        />
        <Button onClick={() => void load(true)} variant="ghost" className="rounded-none text-xs tracking-luxury mt-2">
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> 更新
        </Button>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border mb-10 border border-border">
        <StatCard label="全配信" value={stats.total} icon={Mail} color="text-foreground" />
        <StatCard label="送信成功" value={stats.sent} icon={CheckCircle2} color="text-success" />
        <StatCard label="失敗" value={stats.failed} icon={XCircle} color="text-destructive" />
        <StatCard label="配信停止" value={stats.suppressed} icon={ShieldOff} color="text-warning" />
      </div>

      {/* フィルタ */}
      <div className="flex flex-col md:flex-row gap-4 mb-10">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-full md:w-40 rounded-none border-x-0 border-t-0 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map(r => <SelectItem key={r.value} value={r.value}>過去{r.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={tplFilter} onValueChange={setTplFilter}>
          <SelectTrigger className="w-full md:w-56 rounded-none border-x-0 border-t-0 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべての種類</SelectItem>
            {templates.map(t => (
              <SelectItem key={t} value={t}>{TEMPLATE_LABEL[t] || t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-48 rounded-none border-x-0 border-t-0 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべての状態</SelectItem>
            <SelectItem value="sent">送信成功</SelectItem>
            <SelectItem value="pending">送信中</SelectItem>
            <SelectItem value="failed">失敗</SelectItem>
            <SelectItem value="suppressed">配信停止</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="py-24 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center">
          <p className="eyebrow mb-3">— No Records —</p>
          <p className="text-sm text-muted-foreground">該当するメール配信履歴はまだありません</p>
        </div>
      ) : (
        <div className="border-t border-border">
          <div className="grid grid-cols-12 gap-4 py-4 border-b border-border text-[11px] font-serif text-muted-foreground">
            <div className="col-span-3">種類</div>
            <div className="col-span-4">宛先</div>
            <div className="col-span-2">日時</div>
            <div className="col-span-3">状態</div>
          </div>
          {filtered.map(r => {
            const info = STATUS_INFO[r.status] || { label: r.status, color: "text-muted-foreground", icon: Mail };
            const Icon = info.icon;
            return (
              <div key={r.id} className="grid grid-cols-12 gap-4 py-4 border-b border-border/60 hover:bg-secondary/30 transition-colors items-center">
                <div className="col-span-3 font-serif text-sm">
                  {TEMPLATE_LABEL[r.template_name || ""] || r.template_name || "—"}
                </div>
                <div className="col-span-4 text-xs text-muted-foreground truncate">{r.recipient_email || "—"}</div>
                <div className="col-span-2 text-[11px] font-serif-en text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="col-span-3">
                  <span className={`inline-flex items-center gap-2 text-[11px] font-serif ${info.color}`}>
                    <Icon className="w-3 h-3" />
                    {info.label}
                  </span>
                  {r.error_message && (
                    <div className="text-[10px] text-destructive/70 truncate mt-1" title={r.error_message}>
                      {r.error_message}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div className="py-6 text-center">
              <Button
                variant="outline"
                className="rounded-none"
                disabled={loadingMore}
                onClick={() => void load(false)}
              >
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                さらに読み込む
              </Button>
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
};

const StatCard = ({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) => (
  <div className="bg-background p-6">
    <div className="flex items-center justify-between mb-3">
      <span className="eyebrow text-[10px] text-muted-foreground">{label}</span>
      <Icon className={`w-3.5 h-3.5 ${color}`} />
    </div>
    <div className={`font-serif text-3xl ${color}`}>{value.toLocaleString()}</div>
  </div>
);

export default EmailLogs;
