import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Log = {
  id: string;
  source: string;
  status: string;
  raw_to: string | null;
  raw_from: string | null;
  raw_subject: string | null;
  raw_text: string | null;
  parsed_data: any;
  error: string | null;
  created_booking_id: string | null;
  created_at: string;
};

const statusBadge = (s: string) => {
  if (s === "received" || s === "processed" || s === "created") return { Icon: CheckCircle2, color: "text-success", label: "登録済" };
  if (s === "duplicate") return { Icon: CheckCircle2, color: "text-muted-foreground", label: "重複" };
  if (s === "skipped") return { Icon: AlertCircle, color: "text-gold", label: "スキップ" };
  if (s === "verification") return { Icon: AlertCircle, color: "text-blue-600", label: "認証メール" };
  if (s === "other") return { Icon: AlertCircle, color: "text-muted-foreground", label: "その他" };
  if (s === "needs_review") return { Icon: AlertCircle, color: "text-amber-600", label: "要確認" };
  if (s === "failed") return { Icon: XCircle, color: "text-destructive", label: "失敗" };
  return { Icon: AlertCircle, color: "text-muted-foreground", label: s };
};

const InboundLogs = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [detail, setDetail] = useState<Log | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    let q = supabase
      .from("external_reservation_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data, error } = await q;
    if (error) toast.error("取得失敗: " + error.message);
    setLogs((data || []) as Log[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, statusFilter]);

  const reprocess = async () => {
    setReprocessing(true);
    const { data, error } = await supabase.functions.invoke("reprocess-inbound-logs", {
      body: { limit: 50 },
    });
    setReprocessing(false);
    if (error) { toast.error("再処理失敗: " + error.message); return; }
    toast.success(`再処理 ${data?.processed ?? 0} 件を実行しました`);
    load();
  };

  const counts = logs.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.21 — Inbound Reservation Logs"
        title="予約取込ログ"
        description="ホットペッパー / minimo / 楽天Beauty からの転送メール処理状況"
      />

      <div className="flex items-center gap-3 mb-8">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 rounded-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全て</SelectItem>
            <SelectItem value="received">登録済</SelectItem>
            <SelectItem value="duplicate">重複</SelectItem>
            <SelectItem value="skipped">スキップ</SelectItem>
            <SelectItem value="verification">認証メール</SelectItem>
            <SelectItem value="other">その他</SelectItem>
            <SelectItem value="needs_review">要確認</SelectItem>
            <SelectItem value="failed">失敗</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="rounded-none" onClick={load}>
          <RefreshCw className="w-3.5 h-3.5 mr-2" />更新
        </Button>
        <Button className="rounded-none" onClick={reprocess} disabled={reprocessing}>
          {reprocessing ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
          失敗・スキップを再処理（最大50件）
        </Button>
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span>登録 <span className="text-success font-serif-en">{counts.received || 0}</span></span>
          <span>スキップ <span className="text-gold font-serif-en">{counts.skipped || 0}</span></span>
          <span>失敗 <span className="text-destructive font-serif-en">{counts.failed || 0}</span></span>
        </div>
      </div>

      {loading ? (
        <div className="py-24 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" />
        </div>
      ) : logs.length === 0 ? (
        <div className="py-24 text-center">
          <p className="eyebrow mb-3">— No Inbound Logs —</p>
          <p className="text-sm text-muted-foreground">転送メールを設定すると、ここに処理履歴が表示されます</p>
        </div>
      ) : (
        <div className="border-t border-border">
          {logs.map((log) => {
            const s = statusBadge(log.status);
            const customerName = log.parsed_data?.customer_name;
            const bookingDate = log.parsed_data?.booking_date;
            const bookingTime = log.parsed_data?.booking_time;
            return (
              <button
                key={log.id}
                className="w-full grid grid-cols-12 gap-4 py-5 border-b border-border/60 items-center text-left hover:bg-secondary/30 transition-colors px-2"
                onClick={() => setDetail(log)}
              >
                <div className="col-span-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-serif ${s.color}`}>
                    <s.Icon className="w-3.5 h-3.5 stroke-[1.5]" />
                    {s.label}
                  </span>
                  <div className="eyebrow text-[9px] text-muted-foreground mt-1">{log.source}</div>
                </div>
                <div className="col-span-3">
                  <div className="font-serif text-sm truncate">{log.raw_subject || "(件名なし)"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{log.raw_from || "—"}</div>
                </div>
                <div className="col-span-3 text-xs">
                  {customerName ? (
                    <>
                      <div className="font-serif">{customerName} 様</div>
                      <div className="text-muted-foreground">{bookingDate} {bookingTime}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground italic">— 未抽出 —</div>
                  )}
                </div>
                <div className="col-span-2 text-[11px] text-destructive truncate">
                  {log.error || ""}
                </div>
                <div className="col-span-2 text-[11px] text-muted-foreground text-right font-serif-en">
                  {new Date(log.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="rounded-none max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif">取込ログ詳細</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="eyebrow text-[10px] block mb-1">ステータス</span>{statusBadge(detail.status).label}</div>
                <div><span className="eyebrow text-[10px] block mb-1">ソース</span>{detail.source}</div>
                <div><span className="eyebrow text-[10px] block mb-1">From</span>{detail.raw_from}</div>
                <div><span className="eyebrow text-[10px] block mb-1">To</span>{detail.raw_to}</div>
                <div className="col-span-2"><span className="eyebrow text-[10px] block mb-1">件名</span>{detail.raw_subject}</div>
                {detail.error && <div className="col-span-2"><span className="eyebrow text-[10px] block mb-1">エラー</span><span className="text-destructive">{detail.error}</span></div>}
              </div>

              {detail.parsed_data && (
                <div>
                  <span className="eyebrow text-[10px] block mb-1">AI抽出結果</span>
                  <pre className="bg-secondary/50 p-3 text-[11px] overflow-x-auto rounded-none font-mono">{JSON.stringify(detail.parsed_data, null, 2)}</pre>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="eyebrow text-[10px]">本文（先頭4000文字）</span>
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    onClick={() => { navigator.clipboard.writeText(detail.raw_text || ""); toast.success("コピーしました"); }}
                  >
                    <Copy className="w-3 h-3" />コピー
                  </button>
                </div>
                <pre className="bg-secondary/50 p-3 text-[11px] overflow-x-auto rounded-none whitespace-pre-wrap max-h-64 overflow-y-auto">{detail.raw_text || "(本文なし)"}</pre>
              </div>

              {detail.created_booking_id && (
                <div className="text-xs text-success">→ 予約 {detail.created_booking_id} を作成済み</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default InboundLogs;
