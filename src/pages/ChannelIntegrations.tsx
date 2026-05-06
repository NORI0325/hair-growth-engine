import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, PlugZap, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const CHANNELS = [
  { key: "salonboard", label: "ホットペッパー / サロンボード" },
  { key: "rakuten_beauty", label: "楽天ビューティー" },
  { key: "line_reservation", label: "LINE予約" },
  { key: "google_reservation", label: "Google予約" },
  { key: "own_web", label: "自社Web予約" },
  { key: "phone", label: "電話予約" },
] as const;

type Integration = {
  id?: string;
  channel: string;
  enabled: boolean;
  sync_enabled: boolean;
  last_synced_at?: string | null;
  last_status?: string | null;
  failure_count?: number | null;
  last_error?: string | null;
  note?: string | null;
  connection_status?: string | null;
};

type WorkerLog = {
  id: string;
  kind: string;
  response_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
};

export default function ChannelIntegrations() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Record<string, Integration>>({});
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; steps: any[] } | null>(null);
  const [logs, setLogs] = useState<WorkerLog[]>([]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("channel_integrations").select("*").eq("owner_id", user.id);
    const map: Record<string, Integration> = {};
    for (const c of CHANNELS) {
      const found = data?.find((d) => d.channel === c.key);
      map[c.key] = found ?? { channel: c.key, enabled: false, sync_enabled: false, failure_count: 0 };
    }
    setRows(map);
    setLoading(false);
    // 直近の Worker ログ
    const { data: logRows } = await supabase.from("worker_request_logs")
      .select("id,kind,response_status,latency_ms,success,error_message,created_at")
      .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(10);
    setLogs((logRows as WorkerLog[]) || []);
  };

  useEffect(() => { load(); }, [user]);

  const runConnectionTest = async () => {
    if (!user) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("salonboard-connection-test", {
        body: { owner_id: user.id, location_id: null },
      });
      if (error) {
        toast.error("疎通テスト失敗: " + error.message);
        setTestResult({ ok: false, steps: [{ kind: "invoke_error", ok: false, error: error.message }] });
      } else {
        setTestResult(data);
        if (data?.ok) toast.success("疎通テスト成功 → ライブ運用開始");
        else toast.error("疎通テストで一部ステップが失敗しました");
      }
    } finally {
      setTesting(false);
      load();
    }
  };

  const upsert = async (channel: string, patch: Partial<Integration>) => {
    if (!user) return;
    const cur = rows[channel];
    const next = { ...cur, ...patch };
    setRows({ ...rows, [channel]: next });
    const { error } = await supabase.from("channel_integrations").upsert({
      owner_id: user.id,
      channel,
      enabled: next.enabled,
      sync_enabled: next.sync_enabled,
      note: next.note ?? null,
    }, { onConflict: "owner_id,location_id,channel" });
    if (error) toast.error("保存に失敗しました: " + error.message);
  };

  const retry = async (channel: string) => {
    // この媒体宛のpending/failedジョブを再投入
    const { data: jobs } = await supabase.from("sync_jobs")
      .select("id").eq("target_channel", channel).in("status", ["pending", "failed", "needs_review"]).limit(50);
    if (!jobs || jobs.length === 0) {
      toast.info("再同期対象のジョブはありません");
      return;
    }
    const res = await supabase.functions.invoke("sync-job-dispatch", { body: { job_ids: jobs.map(j => j.id) } });
    if (res.error) toast.error("再同期失敗: " + res.error.message);
    else toast.success(`${jobs.length}件のジョブを再同期しました`);
    load();
  };

  return (
    <div className="container max-w-5xl py-12 px-6">
      <div className="mb-10">
        <div className="text-[10px] tracking-luxury text-gold mb-2">CHANNEL INTEGRATIONS</div>
        <h1 className="font-serif text-3xl mb-2">外部媒体連携</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          外部予約媒体との同期設定を管理します。サロンボード等のログイン情報は外部ワーカー側で安全に保管され、本アプリには保存されません。<br />
          画像認証や外部側の仕様変更が発生した場合は自動処理を停止し、要確認キューでお知らせします。
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">読み込み中...</div>
      ) : (
        <div className="space-y-5">
          {CHANNELS.map((c) => {
            const r = rows[c.key];
            const status = r.last_status;
            return (
              <Card key={c.key} className="rounded-none border-border p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h3 className="font-serif text-lg">{c.label}</h3>
                      {c.key === "salonboard" && r.connection_status === "live" && <Badge className="rounded-none bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />ライブ運用中</Badge>}
                      {c.key === "salonboard" && r.connection_status === "needs_review" && <Badge className="rounded-none bg-red-50 text-red-700 border-red-200"><AlertTriangle className="w-3 h-3 mr-1" />要確認</Badge>}
                      {c.key === "salonboard" && r.connection_status === "error" && <Badge className="rounded-none bg-red-50 text-red-700 border-red-200"><AlertTriangle className="w-3 h-3 mr-1" />エラー</Badge>}
                      {c.key === "salonboard" && (!r.connection_status || r.connection_status === "disconnected") && <Badge variant="outline" className="rounded-none">未接続</Badge>}
                      {status === "success" && c.key !== "salonboard" && <Badge className="rounded-none bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />成功</Badge>}
                      {(status === "failed" || status === "needs_review") && c.key !== "salonboard" && <Badge className="rounded-none bg-red-50 text-red-700 border-red-200"><AlertTriangle className="w-3 h-3 mr-1" />要確認</Badge>}
                      {status === "pending" && <Badge className="rounded-none bg-amber-50 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" />同期待ち</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      最終同期: {r.last_synced_at ? new Date(r.last_synced_at).toLocaleString("ja-JP") : "-"}
                      {(r.failure_count ?? 0) > 0 && <span className="ml-3 text-red-600">失敗: {r.failure_count}回</span>}
                    </div>
                    {r.last_error && <div className="mt-2 text-xs text-red-600 bg-red-50 px-2 py-1">{r.last_error}</div>}
                  </div>
                  <div className="flex flex-col gap-2">
                    {c.key === "salonboard" && (
                      <>
                        <Button variant="default" size="sm" className="rounded-none" onClick={() => (window.location.href = "/onboarding/salonboard")}>
                          セットアップ
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-none" disabled={testing} onClick={runConnectionTest}>
                          {testing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <PlugZap className="w-3 h-3 mr-1" />}
                          疎通テスト
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" className="rounded-none" onClick={() => retry(c.key)}>
                      <RefreshCw className="w-3 h-3 mr-1" />再同期
                    </Button>
                  </div>
                </div>

                {c.key === "salonboard" && testResult && (
                  <div className="border border-border p-3 text-xs space-y-1 bg-secondary/20">
                    <div className="font-serif mb-1">疎通テスト結果</div>
                    {testResult.steps.map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        {s.ok ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <AlertTriangle className="w-3 h-3 text-red-600" />}
                        <span className="font-mono">{s.kind}</span>
                        {s.status && <span className="text-muted-foreground">HTTP {s.status}</span>}
                        {s.latency_ms != null && <span className="text-muted-foreground">{s.latency_ms}ms</span>}
                        {s.error && <span className="text-red-600">{s.error}</span>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6 pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">連携を有効化</Label>
                    <Switch checked={r.enabled} onCheckedChange={(v) => upsert(c.key, { enabled: v, sync_enabled: v ? r.sync_enabled : false })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">同期対象にする</Label>
                    <Switch checked={r.sync_enabled} disabled={!r.enabled} onCheckedChange={(v) => upsert(c.key, { sync_enabled: v })} />
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">備考メモ</Label>
                  <Input value={r.note ?? ""} onChange={(e) => setRows({ ...rows, [c.key]: { ...r, note: e.target.value } })}
                    onBlur={() => upsert(c.key, { note: r.note })}
                    placeholder="例：担当者メモ・運用ルール等"
                    className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-10">
          <div className="text-[10px] tracking-luxury text-gold mb-2">WORKER REQUEST LOGS</div>
          <h2 className="font-serif text-lg mb-3">直近のワーカー送信ログ</h2>
          <div className="border border-border divide-y divide-border text-xs">
            {logs.map((l) => (
              <div key={l.id} className="px-3 py-2 flex items-center gap-3 flex-wrap">
                {l.success ? <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />}
                <span className="font-mono">{l.kind}</span>
                <span className="text-muted-foreground">HTTP {l.response_status ?? "-"}</span>
                <span className="text-muted-foreground">{l.latency_ms ?? "-"}ms</span>
                <span className="text-muted-foreground ml-auto">{new Date(l.created_at).toLocaleString("ja-JP")}</span>
                {l.error_message && <div className="w-full text-red-600 mt-1">{l.error_message}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 p-5 bg-secondary/30 border border-border text-xs text-muted-foreground leading-relaxed">
        <div className="font-serif text-foreground mb-2">⚠️ 安全運用について</div>
        <ul className="list-disc list-inside space-y-1">
          <li>本機能は店舗様が正当に管理権限を持つ自社アカウントのみを対象としています</li>
          <li>外部サービス側の規約に反する操作・画像認証回避は実装していません</li>
          <li>画像認証 / ログイン失敗 / 画面変更を検知した場合は自動処理を停止します</li>
          <li>同期失敗は「要確認キュー」で確認できます</li>
        </ul>
      </div>
    </div>
  );
}
