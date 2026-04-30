import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

const SalonBoardExport = () => {
  const downloadExtension = () => {
    fetch("/salonboard-exporter.zip")
      .then((res) => {
        if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "salonboard-exporter.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert(err.message));
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.99 — Backup Tool"
        title="サロンボード顧客データ抽出"
        description="Chrome拡張機能でホットペッパービューティーから安全にお客様情報をバックアップ"
      />

      <div className="max-w-3xl space-y-10 mt-10">
        {/* ダウンロード */}
        <section className="border border-border p-8">
          <p className="eyebrow mb-3">— Step 01 / Download —</p>
          <h2 className="display text-2xl mb-4">拡張機能をダウンロード</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            Chrome / Edge / Brave などの Chromium 系ブラウザで動作する専用拡張機能です。
            サロンボードにログインした状態のあなたのブラウザ内で動作するため、
            安全に顧客データを抽出できます。最新版は <strong>v1.7.0</strong> です。
          </p>
          <Button
            onClick={downloadExtension}
            className="rounded-none px-6 py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow"
          >
            <Download className="w-4 h-4 mr-2 stroke-[1.5]" />
            拡張機能をダウンロード
            <span className="ml-2 opacity-60 text-[10px]">.ZIP</span>
          </Button>
        </section>

        {/* インストール */}
        <section className="border border-border p-8">
          <p className="eyebrow mb-3">— Step 02 / Install —</p>
          <h2 className="display text-2xl mb-4">ブラウザにインストール</h2>
          <ol className="space-y-4 text-sm leading-relaxed">
            <li className="flex gap-4">
              <span className="font-serif-en text-gold shrink-0">01.</span>
              <span>ダウンロードした <code className="text-xs bg-secondary px-1.5 py-0.5">salonboard-exporter.zip</code> を解凍してください</span>
            </li>
            <li className="flex gap-4">
              <span className="font-serif-en text-gold shrink-0">02.</span>
              <span>
                Chromeのアドレスバーに <code className="text-xs bg-secondary px-1.5 py-0.5">chrome://extensions</code> と入力して開く
              </span>
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
              <span>ブラウザ右上のパズルアイコンから「Salon Board Customer Exporter」を固定表示にしておく</span>
            </li>
          </ol>
        </section>

        {/* 使い方 */}
        <section className="border border-border p-8">
          <p className="eyebrow mb-3">— Step 03 / Use —</p>
          <h2 className="display text-2xl mb-4">使い方</h2>

          <div className="space-y-6 text-sm leading-relaxed">
            <div>
              <h3 className="font-serif text-base mb-2 text-gold">① 一覧スキャン（推奨・先に実行）</h3>
              <ol className="space-y-2 ml-4 text-muted-foreground">
                <li>1. サロンボードにログインし「お客様管理 → お客様一覧」を開く</li>
                <li>2. 拡張機能のアイコンをクリック</li>
                <li>3. まず「現在ページを診断」を押し、「50行抽出」と出ることを確認</li>
                <li>4.「一覧をスキャン開始」を押す（保存済みデータは自動クリア）</li>
                <li>5. 全26ページを自動巡回（約1〜2分）</li>
                <li>6. 完了後「CSVダウンロード」で基本情報を取得</li>
              </ol>
            </div>

            <div>
              <h3 className="font-serif text-base mb-2 text-gold">② 詳細スキャン（電話・メール・誕生日も取得）</h3>
              <ol className="space-y-2 ml-4 text-muted-foreground">
                <li>1. 一覧スキャン完了後、「詳細スキャン開始」を押す</li>
                <li>2. 各顧客の詳細ページを順次取得（1,260名 × 約3秒 = 約60〜90分）</li>
                <li>3. 同じ顧客で止まらないよう、失敗した顧客は自動で記録して次へ進みます</li>
                <li>4. 完了後「CSVダウンロード」で完全版を取得</li>
              </ol>
            </div>

            <div>
              <h3 className="font-serif text-base mb-2 text-gold">③ このシステムへ取り込み</h3>
              <p className="text-muted-foreground mb-3">
                取得したCSVは、お客様一括登録機能でこのシステムに取り込めます。
              </p>
              <Button asChild variant="outline" className="rounded-none">
                <Link to="/import">
                  <ExternalLink className="w-3.5 h-3.5 mr-2 stroke-[1.5]" />
                  一括登録ページへ
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* 注意事項 */}
        <section className="border border-gold/30 bg-gold/5 p-8">
          <p className="eyebrow mb-3 text-gold">— Important Notes —</p>
          <h2 className="display text-xl mb-4">ご注意</h2>
          <ul className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <li>・ サーバー負荷を避けるため、ページ間隔は <strong>2.5秒以上</strong> を推奨します</li>
            <li>・ 取得データは <strong>個人情報</strong> を含みます。USB等での持ち出しや無断共有はお控えください</li>
            <li>・ スキャン中はサロンボードのタブを操作しないでください（自動操作の妨げになります）</li>
            <li>・ ホットペッパービューティーの利用規約は事前にご確認ください</li>
            <li>・ 万が一のため、月1回程度の定期バックアップをおすすめします</li>
          </ul>
        </section>
      </div>
    </AppLayout>
  );
};

export default SalonBoardExport;
