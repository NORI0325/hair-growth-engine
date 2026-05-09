import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, CheckCheck, FileSearch, GitCompare, AlertCircle, MapPinOff, Send, Download } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import SyncStatusDialog from "@/components/SyncStatusDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  external_missing: { text: "サロンボードに無い", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  local_missing:    { text: "アプリに無い",       tone: "bg-amber-50 text-amber-800 border-amber-200" },
  conflict:         { text: "差異あり",            tone: "bg-red-50 text-red-700 border-red-200" },
  failed:           { text: "同期失敗",            tone: "bg-red-50 text-red-700 border-red-200" },
  needs_review:     { text: "要確認",              tone: "bg-red-50 text-red-700 border-red-200" },
};

interface Row {
  id: string;
  booking_date: string;
  booking_time: string;
  menu: string;
  status: string;
  staff_id: string | null;
  customer_id: string;
  location_id: string | null;
  external_reservation_id: string | null;
  external_source: string | null;
  source_channel: string | null;
  sync_status: string;
  last_sync_error: string | null;
  sync_error_message: string | null;
  last_synced_at: string | null;
  needs_manual_review: boolean;
  customers: { full_name: string | null } | null;
  staff: { name: string | null } | null;
  // 結合用
  latest_snapshot?: { id: string; result: string; reason: string | null; checked_at: string; diff: any; local_payload: any; external_payload: any } | null;
  latest_job?: { id: string; status: string; error_type: string | null; error_message: string | null; updated_at: string; job_type: string } | null;
}

interface InboundLog {
  id: string;
  source: string;
  raw_subject: string | null;
  raw_from: string | null;
  status: string;
  error: string | null;
  parsed_data: any;
  created_booking_id: string | null;
  created_at: string;
}

export default function SyncReview() {
  const { user } = useAuth();
  const [items, setItems] = useState<Row[]>([]);
  const [inboundLogs, setInboundLogs] = useState<InboundLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncTarget, setSyncTarget] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<Row | null>(null);
  const [errorTarget, setErrorTarget] = useState<Row | null>(null);
  const [inboundDetail, setInboundDetail] = useState<InboundLog | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);

    // bookings: sync_status が要確認 or location_id NULL（カレンダー欠落事故防止）
    const { data: bookings } = await supabase
      .from("bookings")
      .select(`
        id, booking_date, booking_time, menu, status, staff_id, customer_id, location_id,
        external_reservation_id, external_source, source_channel,
        sync_status, last_sync_error, sync_error_message, last_synced_at, needs_manual_review,
        customers:customer_id(full_name),
        staff:staff_id(name)
      `)
      .eq("owner_id", user.id)
      .or(
        "sync_status.in.(external_missing,local_missing,conflict,failed,needs_review),location_id.is.null,needs_manual_review.eq.true",
      )
      .gte("booking_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
      .order("booking_date", { ascending: false })
      .limit(200);

    const rows: Row[] = (bookings as any) ?? [];
    const ids = rows.map((r) => r.id);

    // 最新スナップショット & 最新 sync_job を取得
    let snapMap: Record<string, any> = {};
    let jobMap: Record<string, any> = {};
    if (ids.length > 0) {
      const [snap, job] = await Promise.all([
        supabase.from("sync_diff_snapshots")
          .select("id, booking_id, result, reason, checked_at, diff, local_payload, external_payload")
          .in("booking_id", ids)
          .order("checked_at", { ascending: false }),
        supabase.from("sync_jobs")
          .select("id, reservation_id, status, error_type, error_message, updated_at, job_type")
          .in("reservation_id", ids)
          .order("updated_at", { ascending: false }),
      ]);
      for (const s of (snap.data ?? []) as any[]) {
        if (!snapMap[s.booking_id]) snapMap[s.booking_id] = s;
      }
      for (const j of (job.data ?? []) as any[]) {
        if (!jobMap[j.reservation_id]) jobMap[j.reservation_id] = j;
      }
    }

    setItems(rows.map((r) => ({ ...r, latest_snapshot: snapMap[r.id] ?? null, latest_job: jobMap[r.id] ?? null })));

    // 外部通知メール取り込みの needs_review もここに統合表示
    const { data: logs } = await supabase
      .from("external_reservation_logs" as any)
      .select("id, source, raw_subject, raw_from, status, error, parsed_data, created_booking_id, created_at")
      .eq("owner_id", user.id)
      .eq("status", "needs_review")
      .order("created_at", { ascending: false })
      .limit(100);
    setInboundLogs((logs as any) ?? []);

    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const markResolved = async (b: Row) => {
    if (!confirm("この予約を「確認済み」にします。よろしいですか？")) return;
    await supabase.from("bookings").update({
      needs_manual_review: false,
      sync_status: "not_required",
    }).eq("id", b.id);
    if (b.latest_job?.id && (b.latest_job.status === "failed" || b.latest_job.status === "needs_review")) {
      await supabase.from("sync_jobs").update({ status: "cancelled", error_message: "管理者により確認済み" }).eq("id", b.latest_job.id);
    }
    toast.success("確認済みにしました");
    load();
  };

  const resendOne = async (b: Row) => {
    if (!confirm(`「${b.customers?.full_name ?? "顧客"}」${b.booking_date} ${b.booking_time?.slice(0,5)} の予約をサロンボードへ再送信します。\n\n直前にサロンボード側を再照合し、外部に予約が無い場合のみ送信します。\n候補が見つかった場合は二重予約防止のため送信を中止します。\n\n実行しますか？`)) return;
    const { data: res, error } = await supabase.functions.invoke("sync-resend-to-salonboard", { body: { booking_id: b.id } });
    if (error) { toast.error("再送信失敗: " + error.message); return; }
    const r: any = res;
    if (r?.action === "enqueued") toast.success(r.message);
    else if (r?.action === "refused") toast.warning(r.message);
    else if (r?.action === "skipped") toast.info(r.message);
    else if (r?.error) toast.error(r.message ?? r.error);
    load();
  };

  return (
    <div className="container max-w-6xl py-12 px-6">
      <div className="mb-10">
        <div className="text-[10px] tracking-luxury text-gold mb-2">SYNC REVIEW</div>
        <h1 className="font-serif text-3xl mb-2">同期エラー一覧</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          サロンボードへの同期に失敗した予約、差異が検出された予約、店舗未割当の予約をまとめて確認できます。<br />
          <span className="text-amber-700">第3段階：再送信は直前照合付き、取り込みは external_reservation_id 重複防止付き、競合は管理者判断のみ。自動上書きは行いません。</span>
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">読み込み中...</div>
      ) : items.length === 0 ? (
        <Card className="rounded-none p-12 text-center text-muted-foreground">
          <CheckCheck className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
          要確認の予約はありません
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((b) => {
            const label = STATUS_LABEL[b.sync_status] ?? null;
            const noLocation = !b.location_id;
            return (
              <Card key={b.id} className={`rounded-none border-l-4 ${noLocation ? "border-l-orange-500" : "border-l-red-500"} p-5`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {label && (
                        <Badge className={`rounded-none ${label.tone} border`}>
                          <AlertTriangle className="w-3 h-3 mr-1" />{label.text}
                        </Badge>
                      )}
                      {noLocation && (
                        <Badge className="rounded-none bg-orange-50 text-orange-800 border-orange-200">
                          <MapPinOff className="w-3 h-3 mr-1" />店舗未割当
                        </Badge>
                      )}
                      {b.needs_manual_review && (
                        <Badge className="rounded-none bg-secondary text-foreground border">手動確認待ち</Badge>
                      )}
                      {b.external_source && (
                        <Badge variant="outline" className="rounded-none text-[10px]">取込元: {b.external_source}</Badge>
                      )}
                    </div>

                    <div className="text-sm">
                      <span className="font-serif">{b.customers?.full_name ?? "顧客不明"}</span>
                      <span className="text-muted-foreground"> ・ {b.booking_date} {b.booking_time?.slice(0, 5)} ・ {b.menu}</span>
                      <span className="text-muted-foreground"> ・ 担当: {b.staff?.name ?? <em>未指定（フリー）</em>}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <Field k="sync_status" v={b.sync_status} />
                      <Field k="external_reservation_id" v={b.external_reservation_id ?? "—"} />
                      <Field k="最終同期" v={b.last_synced_at ? new Date(b.last_synced_at).toLocaleString("ja-JP") : "—"} />
                      <Field k="最終確認" v={b.latest_snapshot?.checked_at ? new Date(b.latest_snapshot.checked_at).toLocaleString("ja-JP") : "—"} />
                    </div>

                    {(b.last_sync_error || b.sync_error_message) && (
                      <div className="text-xs text-red-600 bg-red-50 px-2 py-1">
                        {b.last_sync_error || b.sync_error_message}
                      </div>
                    )}
                    {b.latest_job && (b.latest_job.error_type || b.latest_job.error_message) && (
                      <div className="text-[11px] text-muted-foreground">
                        ジョブ: {b.latest_job.job_type} / {b.latest_job.status}
                        {b.latest_job.error_type && ` / ${b.latest_job.error_type}`}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="rounded-none" onClick={() => setSyncTarget(b.id)}>
                      <FileSearch className="w-3 h-3 mr-1" />同期状態を確認
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-none" disabled={!b.latest_snapshot} onClick={() => setDiffTarget(b)} title={!b.latest_snapshot ? "先に「同期状態を確認」を実行してください" : ""}>
                      <GitCompare className="w-3 h-3 mr-1" />差分を確認
                    </Button>
                    {(b.sync_status === "external_missing" || b.latest_snapshot?.result === "local_only") && b.location_id && (
                      <Button size="sm" className="rounded-none" onClick={() => resendOne(b)}>
                        <Send className="w-3 h-3 mr-1" />サロンボードへ再送信
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="rounded-none" disabled={!(b.last_sync_error || b.sync_error_message || b.latest_job?.error_message)} onClick={() => setErrorTarget(b)}>
                      <AlertCircle className="w-3 h-3 mr-1" />エラー内容
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-none" onClick={() => markResolved(b)}>
                      <CheckCheck className="w-3 h-3 mr-1" />解消済みに
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {syncTarget && (
        <SyncStatusDialog
          bookingId={syncTarget}
          open={!!syncTarget}
          onOpenChange={(o) => { if (!o) { setSyncTarget(null); load(); } }}
        />
      )}

      {/* 差分表示ダイアログ */}
      <Dialog open={!!diffTarget} onOpenChange={(o) => !o && setDiffTarget(null)}>
        <DialogContent className="rounded-none max-w-3xl">
          <DialogHeader><DialogTitle className="font-serif">差分を確認</DialogTitle></DialogHeader>
          {diffTarget?.latest_snapshot ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                最終確認: {new Date(diffTarget.latest_snapshot.checked_at).toLocaleString("ja-JP")} ／ 結果: {diffTarget.latest_snapshot.result}
              </p>
              {diffTarget.latest_snapshot.reason && <p className="text-xs">{diffTarget.latest_snapshot.reason}</p>}
              <Section title="アプリ側 (local_payload)">
                <pre className="text-[11px] bg-muted p-2 overflow-auto max-h-60">{JSON.stringify(diffTarget.latest_snapshot.local_payload, null, 2)}</pre>
              </Section>
              <Section title="サロンボード側 (external_payload)">
                <pre className="text-[11px] bg-muted p-2 overflow-auto max-h-60">{JSON.stringify(diffTarget.latest_snapshot.external_payload, null, 2)}</pre>
              </Section>
              <p className="text-[11px] text-muted-foreground">※ 差分の解消（上書き／取込／再送信）は第3段階で手動操作付きで実装します。</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">スナップショットがありません。「同期状態を確認」を先に実行してください。</p>
          )}
        </DialogContent>
      </Dialog>

      {/* エラー詳細ダイアログ */}
      <Dialog open={!!errorTarget} onOpenChange={(o) => !o && setErrorTarget(null)}>
        <DialogContent className="rounded-none max-w-2xl">
          <DialogHeader><DialogTitle className="font-serif">エラー内容</DialogTitle></DialogHeader>
          {errorTarget && (
            <div className="space-y-3 text-sm">
              {errorTarget.last_sync_error && <Section title="last_sync_error"><pre className="text-[11px] bg-red-50 p-2 whitespace-pre-wrap">{errorTarget.last_sync_error}</pre></Section>}
              {errorTarget.sync_error_message && <Section title="sync_error_message"><pre className="text-[11px] bg-red-50 p-2 whitespace-pre-wrap">{errorTarget.sync_error_message}</pre></Section>}
              {errorTarget.latest_job?.error_message && (
                <Section title={`最新ジョブ: ${errorTarget.latest_job.job_type} / ${errorTarget.latest_job.status}`}>
                  <div className="text-[11px] text-muted-foreground mb-1">{errorTarget.latest_job.error_type ?? ""}</div>
                  <pre className="text-[11px] bg-muted p-2 whitespace-pre-wrap">{errorTarget.latest_job.error_message}</pre>
                </Section>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Field = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="truncate"><span className="text-[10px] uppercase tracking-luxury">{k}</span>: <span className="text-foreground">{v}</span></div>
);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-border p-2">
    <div className="eyebrow text-[10px] text-muted-foreground mb-1">{title}</div>
    {children}
  </div>
);
