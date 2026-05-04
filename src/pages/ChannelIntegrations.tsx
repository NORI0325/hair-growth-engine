import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
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
};

export default function ChannelIntegrations() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Record<string, Integration>>({});
  const [loading, setLoading] = useState(true);

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
  };

  useEffect(() => { load(); }, [user]);

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
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-serif text-lg">{c.label}</h3>
                      {status === "success" && <Badge className="rounded-none bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />成功</Badge>}
                      {(status === "failed" || status === "needs_review") && <Badge className="rounded-none bg-red-50 text-red-700 border-red-200"><AlertTriangle className="w-3 h-3 mr-1" />要確認</Badge>}
                      {status === "pending" && <Badge className="rounded-none bg-amber-50 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" />同期待ち</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      最終同期: {r.last_synced_at ? new Date(r.last_synced_at).toLocaleString("ja-JP") : "-"}
                      {(r.failure_count ?? 0) > 0 && <span className="ml-3 text-red-600">失敗: {r.failure_count}回</span>}
                    </div>
                    {r.last_error && <div className="mt-2 text-xs text-red-600 bg-red-50 px-2 py-1">{r.last_error}</div>}
                  </div>
                  <Button variant="outline" size="sm" className="rounded-none" onClick={() => retry(c.key)}>
                    <RefreshCw className="w-3 h-3 mr-1" />再同期
                  </Button>
                </div>

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
