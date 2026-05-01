import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Shield, ExternalLink, AlertCircle, CheckCircle2, History } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

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

const SalonBoardExport = () => {
  const { user } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [logs, setLogs] = useState<ImportLog[]>([]);

  const loadLogs = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("salonboard_import_logs")
      .select("id, created_at, total_received, inserted_count, updated_count, skipped_count, status, error")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setLogs(data || []);
  };

  useEffect(() => { loadLogs(); }, [user]);

  const downloadExtension = async () => {
    setDownloading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        toast.error("ログインが必要です");
        return;
      }
      const url = `https://miyedioemkzhetphjzzg.supabase.co/functions/v1/download-extension`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.session.access_token}` },
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
      toast.success("ダウンロードを開始しました");
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

      <div className="max-w-3xl space-y-8 mt-10">
        {/* セキュリティの仕組み */}
        <section className="border border-gold/30 bg-gold/5 p-8">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-5 h-5 text-gold" />
            <p className="eyebrow text-gold">— Security Design —</p>
          </div>
          <h2 className="display text-xl mb-4">あなたの顧客データを守る設計</h2>
          <ul className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <li className="flex gap-3">
              <CheckCircle2 className="w-4 h-4 text-gold shrink-0 mt-0.5" />
              <span><strong className="text-foreground">CSVは作成されません</strong>。データは拡張機能から直接Salon Boostのサーバーへ送信されます。</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-4 h-4 text-gold shrink-0 mt-0.5" />
              <span><strong className="text-foreground">ログイン中＋契約中のみ動作</strong>。解約後は拡張機能がロックされ、データ取込・再ダウンロード共に不可となります。</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-4 h-4 text-gold shrink-0 mt-0.5" />
              <span><strong className="text-foreground">取込履歴を記録</strong>。誰がいつ何件取り込んだかをすべて監査ログに保存します。</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-4 h-4 text-gold shrink-0 mt-0.5" />
              <span><strong className="text-foreground">店舗ごとに分離</strong>。マルチストア対応により、店舗ごとに独立してデータを管理できます。</span>
            </li>
          </ul>
        </section>

        {/* ダウンロード */}
        <section className="border border-border p-8">
          <p className="eyebrow mb-3">— Step 01 / Download —</p>
          <h2 className="display text-2xl mb-4">拡張機能をダウンロード</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            Chrome / Edge / Brave などの Chromium 系ブラウザで動作する専用拡張機能 <strong>v2.0</strong> です。
            ダウンロードにはログインが必要で、ご契約が有効な間のみ利用可能です。
          </p>
          <Button
            onClick={downloadExtension}
            disabled={downloading}
            className="rounded-none px-6 py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow"
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2 stroke-[1.5]" />
            )}
            拡張機能をダウンロード
            <span className="ml-2 opacity-60 text-[10px]">v2.0 ZIP</span>
          </Button>
        </section>

        {/* インストール */}
        <section className="border border-border p-8">
          <p className="eyebrow mb-3">— Step 02 / Install —</p>
          <h2 className="display text-2xl mb-4">ブラウザにインストール</h2>
          <ol className="space-y-3 text-sm leading-relaxed">
            <li className="flex gap-4">
              <span className="font-serif-en text-gold shrink-0">01.</span>
              <span>ダウンロードした <code className="text-xs bg-secondary px-1.5 py-0.5">salon-boost-importer.zip</code> を解凍します</span>
            </li>
            <li className="flex gap-4">
              <span className="font-serif-en text-gold shrink-0">02.</span>
              <span>Chromeのアドレスバーに <code className="text-xs bg-secondary px-1.5 py-0.5">chrome://extensions</code> と入力</span>
            </li>
            <li className="flex gap-4">
              <span className="font-serif-en text-gold shrink-0">03.</span>
              <span>右上の「<strong>デベロッパーモード</strong>」をONにする</span>
            </li>
            <li className="flex gap-4">
              <span className="font-serif-en text-gold shrink-0">04.</span>
              <span>「<strong>パッケージ化されていない拡張機能を読み込む</strong>」をクリックし、解凍したフォルダを選択</span>
            </li>
            <li className="flex gap-4">
              <span className="font-serif-en text-gold shrink-0">05.</span>
              <span>パズルアイコンから「Salon Boost」を固定表示に</span>
            </li>
          </ol>
        </section>

        {/* 使い方 */}
        <section className="border border-border p-8">
          <p className="eyebrow mb-3">— Step 03 / Use —</p>
          <h2 className="display text-2xl mb-4">使い方</h2>
          <div className="space-y-5 text-sm leading-relaxed">
            <div>
              <h3 className="font-serif text-base mb-2 text-gold">① Salon Boost にログイン</h3>
              <p className="text-muted-foreground">拡張機能アイコンをクリックし、Salon Boostのメールアドレスとパスワードでログインします。</p>
            </div>
            <div>
              <h3 className="font-serif text-base mb-2 text-gold">② 取込先の店舗を選択</h3>
              <p className="text-muted-foreground">複数店舗をご利用の方は、データを取り込む店舗を選択してください。</p>
            </div>
            <div>
              <h3 className="font-serif text-base mb-2 text-gold">③ サロンボードでスキャン実行</h3>
              <p className="text-muted-foreground">サロンボードにログインし「お客様一覧」を開いてから、まず「テスト取得」で動作確認、続いて「Salon Boost へ送信」で本番取込を実行します。</p>
            </div>
            <div>
              <h3 className="font-serif text-base mb-2 text-gold">④ 顧客ページで確認</h3>
              <p className="text-muted-foreground mb-3">取込完了後、Salon Boostの顧客ページで内容を確認できます。</p>
              <Button asChild variant="outline" className="rounded-none">
                <Link to="/customers">
                  <ExternalLink className="w-3.5 h-3.5 mr-2 stroke-[1.5]" />
                  顧客ページへ
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* 取込履歴 */}
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

        {/* 注意事項 */}
        <section className="border border-border bg-secondary/20 p-8">
          <p className="eyebrow mb-3 text-muted-foreground">— Notes —</p>
          <ul className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <li>・ サーバー負荷を避けるため、ページ間隔は <strong>500ms以上</strong> を推奨します</li>
            <li>・ スキャン中はサロンボードのタブを操作しないでください</li>
            <li>・ ホットペッパービューティーの利用規約は事前にご確認ください</li>
            <li>・ ご解約後は拡張機能の動作・再ダウンロード共に停止されます</li>
          </ul>
        </section>
      </div>
    </AppLayout>
  );
};

export default SalonBoardExport;
