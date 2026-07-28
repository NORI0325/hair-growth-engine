import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Shield, ExternalLink, AlertCircle, CheckCircle2, History, Clock, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenant";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { HeroFlow, StepDownload, StepDevMode, StepLoadUnpacked, StepScan } from "@/components/salonboard/StepIllustration";
import HandsOnChecklist from "@/components/salonboard/HandsOnChecklist";
import ExtensionDownloadConsentDialog from "@/components/salonboard/ExtensionDownloadConsentDialog";

interface ImportLog {
  id: string;
  created_at: string;
  total_received: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  status: string;
  error: string | null;
}

const STEPS = [
  { n: "01", title: "ZIPを解凍", caption: "ダウンロードしたファイルをダブルクリック", Illust: StepDownload },
  { n: "02", title: "デベロッパーモードON", caption: "chrome://extensions の右上トグル", Illust: StepDevMode },
  { n: "03", title: "フォルダを読み込む", caption: "「パッケージ化されていない拡張機能」", Illust: StepLoadUnpacked },
  { n: "04", title: "サロンボードへ送信", caption: "ボタン1つで顧客データが流入", Illust: StepScan },
];

const SalonBoardExport = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [downloading, setDownloading] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [logs, setLogs] = useState<ImportLog[]>([]);

  const loadLogs = async () => {
    if (!tenantId || !locationId) return;
    const { data } = await supabase
      .from("salonboard_import_logs")
      .select("id, created_at, total_received, inserted_count, updated_count, skipped_count, status, error")
      .eq("owner_id", tenantId)
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(10);
    setLogs(data || []);
  };

  useEffect(() => { loadLogs(); }, [tenantId, locationId]);

  const openDownloadConsent = () => {
    setConsentOpen(true);
  };

  const performDownload = async (consents: {
    consent_unofficial: boolean;
    consent_risk_self_responsibility: boolean;
    consent_proper_use: boolean;
  }) => {
    setDownloading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        toast.error("ログインが必要です");
        return;
      }
      const url = `https://miyedioemkzhetphjzzg.supabase.co/functions/v1/download-extension`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...consents, tenant_id: tenantId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `ダウンロード失敗 (${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "salon-boost-importer.zip";
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("ダウンロードを開始しました", {
        description: "⚠️ ZIPは必ず解凍してから読み込んでください",
      });
      setConsentOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "ダウンロードに失敗しました");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.99 — Secure Importer"
        title="サロンボード顧客取込"
        description="ホットペッパービューティーから安全に顧客データをSalon Boostへ取り込みます。CSVは作成されず、直接サーバーへ送信されます。"
      />

      <div className="max-w-5xl space-y-12 mt-10">
        {/* HERO — animated flow + 3-min promise */}
        <section className="border border-border bg-gradient-to-b from-secondary/30 to-background p-8 md:p-12">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-gold" />
            <p className="eyebrow text-gold">— 3 minutes to done —</p>
          </div>
          <h2 className="display text-2xl md:text-3xl mb-3">読まずに分かる、4ステップだけ。</h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
            DLして、Chromeに入れて、サロンボードでボタンを1回押す。それで顧客データが Salon Boost に流れ始めます。
          </p>
          <HeroFlow className="w-full max-w-3xl mx-auto" />
        </section>

        {/* Security badges */}
        <section className="border border-gold/30 bg-gold/5 p-8">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-5 h-5 text-gold" />
            <p className="eyebrow text-gold">— Security Design —</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground leading-relaxed">
            {[
              ["CSVは作成されません", "拡張機能から直接サーバーへ送信"],
              ["契約中のみ動作", "解約後はロックされます"],
              ["全取込を監査ログ記録", "誰がいつ何件を可視化"],
              ["店舗ごとに完全分離", "他店舗データは見えません"],
            ].map(([h, s]) => (
              <div key={h} className="flex gap-3">
                <CheckCircle2 className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                <span><strong className="text-foreground">{h}</strong>。{s}。</span>
              </div>
            ))}
          </div>
        </section>

        {/* VISUAL STEP CARDS */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="eyebrow mb-2">— How it works —</p>
              <h2 className="display text-2xl">4ステップで完了</h2>
            </div>
            <Button
              onClick={openDownloadConsent}
              disabled={downloading}
              className="rounded-none px-6 py-5 text-xs tracking-luxury bg-primary hover:bg-primary-glow"
            >
              {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2 stroke-[1.5]" />}
              拡張機能をDL
              <span className="ml-2 opacity-60 text-[10px]">v2.1.3</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map(({ n, title, caption, Illust }) => (
              <div key={n} className="border border-border bg-card hover:border-gold transition-colors">
                <div className="aspect-[16/10] bg-secondary/20 border-b border-border overflow-hidden">
                  <Illust className="w-full h-full" />
                </div>
                <div className="p-4">
                  <p className="font-serif-en text-gold text-sm mb-1">{n}</p>
                  <h3 className="font-serif text-base mb-1">{title}</h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{caption}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* HANDS-ON CHECKLIST */}
        <section className="border border-border p-8">
          <div className="flex items-center justify-between mb-2">
            <p className="eyebrow">— Hands-on Checklist —</p>
          </div>
          <h2 className="display text-2xl mb-2">実機で進める</h2>
          <p className="text-sm text-muted-foreground mb-6">
            進捗は自動保存。最後の「テスト取得成功」だけは取込ログから自動で検知します。
          </p>
          <HandsOnChecklist onDownload={openDownloadConsent} downloading={downloading} />
        </section>

        {/* Stuck? Help */}
        <section className="border border-border bg-secondary/20 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <MessageCircle className="w-5 h-5 text-gold shrink-0 mt-0.5" />
            <div>
              <p className="font-serif text-sm mb-0.5">途中で詰まったら、すぐ聞いてください。</p>
              <p className="text-xs text-muted-foreground">サポートが画面共有でも対応します。</p>
            </div>
          </div>
          <Button asChild variant="outline" className="rounded-none">
            <Link to="/help">
              <ExternalLink className="w-3.5 h-3.5 mr-2 stroke-[1.5]" />
              ヘルプ・問い合わせ
            </Link>
          </Button>
        </section>

        {/* IMPORT HISTORY */}
        <section className="border border-border p-8">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-gold" />
            <p className="eyebrow">— Import History —</p>
          </div>
          <h2 className="display text-xl mb-4">取込履歴</h2>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだ取込履歴はありません。</p>
          ) : (
            <div className="border border-border divide-y divide-border">
              {logs.map((log) => (
                <div key={log.id} className="p-4 grid grid-cols-1 md:grid-cols-6 gap-2 text-xs">
                  <div className="md:col-span-2 font-mono text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("ja-JP")}
                  </div>
                  <div>受信: <strong>{log.total_received}</strong></div>
                  <div className="text-emerald-600">新規: <strong>{log.inserted_count}</strong></div>
                  <div className="text-blue-600">更新: <strong>{log.updated_count}</strong></div>
                  <div className={log.status === "success" ? "text-emerald-600" : log.status === "partial" ? "text-amber-600" : "text-destructive"}>
                    {log.status === "success" ? "✓ 成功" : log.status === "partial" ? "△ 一部失敗" : "✗ 失敗"}
                  </div>
                  {log.error && (
                    <div className="md:col-span-6 text-destructive text-[10px] mt-1">
                      <AlertCircle className="w-3 h-3 inline mr-1" />
                      {log.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="border border-border bg-secondary/20 p-6">
          <p className="eyebrow mb-3 text-muted-foreground">— Notes —</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground leading-relaxed">
            <li>・ ページ間隔は <strong>500ms以上</strong> を推奨します</li>
            <li>・ スキャン中はサロンボードのタブを操作しないでください</li>
            <li>・ ホットペッパービューティーの利用規約は事前にご確認ください</li>
            <li>・ ご解約後は拡張機能の動作・再ダウンロード共に停止されます</li>
          </ul>
        </section>
      </div>

      <ExtensionDownloadConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        onConfirm={performDownload}
        downloading={downloading}
      />
    </AppLayout>
  );
};

export default SalonBoardExport;
