import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, FileSearch, ServerCrash, Send, Download, GitMerge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Result = "local_only" | "external_only" | "match" | "conflict" | "error";

interface Props {
  bookingId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const RESULT_LABEL: Record<Result, { text: string; tone: string; icon: any }> = {
  match: { text: "一致 — サロンボードと同期されています", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  local_only: { text: "アプリ側のみ — サロンボードに該当予約が見つかりません", tone: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle },
  external_only: { text: "サロンボード側のみ — アプリに無い予約です", tone: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle },
  conflict: { text: "差異あり — 内容が一致しません", tone: "bg-red-50 text-red-700 border-red-200", icon: AlertTriangle },
  error: { text: "確認失敗 — 接続エラー / 設定不備", tone: "bg-muted text-foreground border", icon: ServerCrash },
};

export default function SyncStatusDialog({ bookingId, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<null | "resend" | "import" | "resolve">(null);
  const [data, setData] = useState<any>(null);

  const run = async () => {
    setLoading(true);
    setData(null);
    const { data: res, error } = await supabase.functions.invoke("sync-status-check", {
      body: { booking_id: bookingId },
    });
    setLoading(false);
    if (error) {
      toast.error("同期確認失敗: " + error.message);
      return;
    }
    if ((res as any)?.error) {
      toast.error("同期確認失敗: " + ((res as any).message ?? (res as any).error));
      return;
    }
    setData(res);
  };

  const resendToSalonboard = async () => {
    if (!confirm("サロンボードへ再送信します。\n\n直前にもう一度サロンボード側を照合し、外部に予約が無い場合のみ送信します。\n外部に候補が見つかった場合は二重予約防止のため送信を中止します。\n\n実行しますか？")) return;
    setActing("resend");
    const { data: res, error } = await supabase.functions.invoke("sync-resend-to-salonboard", {
      body: { booking_id: bookingId },
    });
    setActing(null);
    if (error) { toast.error("再送信失敗: " + error.message); return; }
    const r: any = res;
    if (r?.action === "enqueued") toast.success(r.message);
    else if (r?.action === "refused") toast.warning(r.message);
    else if (r?.action === "skipped") toast.info(r.message);
    else if (r?.error) toast.error(r.message ?? r.error);
  };

  const resendUpdateToSalonboard = async () => {
    if (!confirm("SalonBoost側の最新内容（日時 / 担当 / 所要時間）でサロンボードを更新します。\nメニュー変更は対象外です。\n\n実行しますか？")) return;
    setActing("resend");
    const { data: res, error } = await supabase.functions.invoke("sync-update-to-salonboard", {
      body: { booking_id: bookingId },
    });
    setActing(null);
    if (error) { toast.error("変更同期失敗: " + error.message); return; }
    const r: any = res;
    if (r?.success && !r?.skipped) toast.success("サロンボードへ変更を送信しました");
    else if (r?.skipped) toast.warning(r?.reason ?? "スキップしました");
    else if (r?.error) toast.error(r?.message ?? r.error);
    await run();
  };

  const importFromSalonboard = async () => {
    const ext = data?.external?.items?.[0];
    if (!ext?.external_reservation_id) { toast.error("external_reservation_id が取得できないため取り込みできません"); return; }
    if (!data?.local?.location_id_for_import && !confirm("location_id を SalonBoost 側の予約と同じにして取り込みます。よろしいですか？")) return;
    if (!confirm(`サロンボード側の予約 (ID: ${ext.external_reservation_id}, ${ext.time ?? "-"}, ${ext.customerName ?? "-"}) を SalonBoost に取り込みます。\n\n情報が不足している場合は「要確認」状態になります。\n\n実行しますか？`)) return;
    setActing("import");
    const { data: res, error } = await supabase.functions.invoke("sync-import-from-salonboard", {
      body: {
        location_id: data.local.location_id ?? null,
        external_reservation_id: ext.external_reservation_id,
        booking_date: data.local.date,
        booking_time: ext.time ? ext.time + ":00" : data.local.time + ":00",
        customer_name: ext.customerName ?? data.local.customer_name,
      },
    });
    setActing(null);
    if (error) { toast.error("取り込み失敗: " + error.message); return; }
    const r: any = res;
    if (r?.action === "imported") toast.success(r.message);
    else if (r?.action === "skipped") toast.info(r.message);
    else if (r?.error) toast.error(r.message ?? r.error);
    await run();
  };

  const resolveConflict = async (decision: "A" | "B" | "C") => {
    const labels: Record<string, string> = {
      A: "SalonBoost の内容でサロンボードを更新します。サロンボード側の予約が書き換わります。",
      B: "サロンボードの内容で SalonBoost を更新します（時刻 / external_id のみ）。",
      C: "差分を据え置き、「対応不要」にします。",
    };
    if (!confirm(labels[decision] + "\n\n実行しますか？")) return;
    setActing("resolve");
    try {
      const { data: res, error } = await supabase.functions.invoke("sync-resolve-conflict", {
        body: { booking_id: bookingId, decision, snapshot_id: data?.snapshot_id },
      });
      if (error) {
        // 失敗時もレスポンスJSONを読み取り、画面を落とさずトーストで通知
        let detail = error.message;
        try {
          const respBody = await (error as any)?.context?.response?.json?.();
          if (respBody?.message) detail = respBody.message;
          else if (respBody?.error) detail = respBody.error;
        } catch { /* noop */ }
        toast.error("競合解消に失敗しました: " + detail);
      } else {
        const r: any = res;
        if (r?.error) toast.error("競合解消に失敗しました: " + (r.message ?? r.error));
        else toast.success(r?.message ?? "処理しました");
      }
    } catch (e) {
      toast.error("競合解消に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setActing(null);
    }
    await run();
  };

  const result: Result | null = data?.result ?? null;
  const label = result ? RESULT_LABEL[result] : null;
  const Icon = label?.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif">同期状態を確認</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            アプリ側とサロンボード側の予約を読み取り専用で照合します。<br />
            この操作では再送信・上書き・取り込みは一切行いません。
          </p>

          {!data && !loading && (
            <Button className="rounded-none w-full" onClick={run}>
              <FileSearch className="w-4 h-4 mr-2" />
              照合を実行
            </Button>
          )}
          {loading && (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          )}

          {data && label && (
            <>
              <div className={`border ${label.tone} px-3 py-2 flex items-center gap-2`}>
                {Icon && <Icon className="w-4 h-4" />}
                <span className="text-sm font-medium">{label.text}</span>
              </div>
              <div className="text-xs text-muted-foreground">{data.reason}</div>

              <Section title="アプリ側の予約">
                <Row k="日時">{data.local.date} {data.local.time}（{data.local.duration ?? 60}分）</Row>
                <Row k="顧客">{data.local.customer_name ?? "—"}</Row>
                <Row k="メニュー">{data.local.menu}</Row>
                <Row k="担当">{data.local.staff_name ?? <span className="text-muted-foreground">未指定 → サロンボード「フリー(0000000000)」に割当</span>}</Row>
                <Row k="external_reservation_id">{data.local.external_reservation_id ?? "—"}</Row>
                <Row k="staff_mapping">
                  {data.local.staff_id ? (
                    data.local.staff_mapping?.external_staff_id
                      ? `${data.local.staff_mapping.external_staff_name ?? ""} (${data.local.staff_mapping.external_staff_id})`
                      : <span className="text-red-600">未マッピング</span>
                  ) : "フリー枠"}
                </Row>
                <Row k="menu_mapping">{data.local.menu_mapping_exists ? "有効" : <span className="text-red-600">未設定</span>}</Row>
                <Row k="channel接続">
                  {data.local.channel_integration ? (
                    <span className="space-x-2">
                      <Badge variant="outline" className="rounded-none text-[10px]">enabled: {String(data.local.channel_integration.enabled)}</Badge>
                      <Badge variant="outline" className="rounded-none text-[10px]">sync: {String(data.local.channel_integration.sync_enabled)}</Badge>
                      <Badge variant="outline" className="rounded-none text-[10px]">{data.local.channel_integration.connection_status}</Badge>
                    </span>
                  ) : "未接続"}
                </Row>
                <Row k="最終ジョブ">
                  {data.local.last_job
                    ? `${data.local.last_job.job_type} / ${data.local.last_job.status} / ${data.local.last_job.error_type ?? "-"}`
                    : "—"}
                </Row>
              </Section>

              <Section title="サロンボード側の検索結果">
                {!data.external.reachable ? (
                  <div className="text-xs text-red-600">{data.external.error ?? "サロンボードへ到達できませんでした"}</div>
                ) : data.external.items.length === 0 ? (
                  <div className="text-xs text-muted-foreground">該当予約なし</div>
                ) : (
                  <div className="space-y-1">
                    {data.external.items.map((it: any, i: number) => (
                      <div key={i} className="text-xs border border-border px-2 py-1">
                        <div>ID: {it.external_reservation_id ?? "—"} ／ 時間: {it.time ?? "—"}</div>
                        <div className="text-muted-foreground truncate">{it.customerName ?? it.raw}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  ※ 二重予約事故を防ぐため、再送信・取り込み・上書きは管理者の明示的な操作でのみ実行されます。<br />
                  再送信時は実行直前にもう一度サロンボード側を照合し、外部に候補がある場合は中止します。
                </p>

                {/* result に応じたアクション */}
                {result === "local_only" && (
                  <Button className="rounded-none w-full" onClick={resendToSalonboard} disabled={!!acting}>
                    {acting === "resend" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                    サロンボードへ再送信（直前照合あり）
                  </Button>
                )}
                {result === "external_only" && (
                  <Button className="rounded-none w-full" onClick={importFromSalonboard} disabled={!!acting}>
                    {acting === "import" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                    SalonBoost へ取り込み
                  </Button>
                )}
                {result === "conflict" && (
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1"><GitMerge className="w-3 h-3" />差分の解消（自動上書きはしません）</div>
                    <Button variant="outline" size="sm" className="rounded-none w-full" disabled={!!acting} onClick={() => resolveConflict("A")}>
                      A. SalonBoost の内容でサロンボードを更新
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-none w-full" disabled={!!acting} onClick={() => resolveConflict("B")}>
                      B. サロンボードの内容で SalonBoost を更新
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-none w-full" disabled={!!acting} onClick={() => resolveConflict("C")}>
                      C. 何もしない（対応不要にする）
                    </Button>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="rounded-none" onClick={run} disabled={loading || !!acting}>再確認</Button>
                  <Button variant="ghost" size="sm" className="rounded-none ml-auto" onClick={() => onOpenChange(false)}>閉じる</Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-border p-3 space-y-1">
    <div className="eyebrow text-[10px] text-muted-foreground mb-1">{title}</div>
    {children}
  </div>
);
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-3 gap-2 text-xs">
    <span className="text-muted-foreground">{k}</span>
    <span className="col-span-2 break-all">{children}</span>
  </div>
);
