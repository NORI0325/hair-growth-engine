import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (consents: {
    consent_unofficial: boolean;
    consent_risk_self_responsibility: boolean;
    consent_proper_use: boolean;
  }) => Promise<void> | void;
  downloading: boolean;
}

const ExtensionDownloadConsentDialog = ({ open, onOpenChange, onConfirm, downloading }: Props) => {
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);
  const [c3, setC3] = useState(false);

  const allChecked = c1 && c2 && c3;

  const handleConfirm = async () => {
    if (!allChecked || downloading) return;
    await onConfirm({
      consent_unofficial: c1,
      consent_risk_self_responsibility: c2,
      consent_proper_use: c3,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-none border-gold/40">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-gold" />
            <p className="eyebrow text-gold text-[10px]">— Important Notice —</p>
          </div>
          <DialogTitle className="display text-xl">ご利用前の重要なご確認</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed pt-2">
            本拡張機能はサロン業務効率化を目的とした補助ツールです。ダウンロード前に、以下の内容をご確認ください。
          </DialogDescription>
        </DialogHeader>

        {/* 実用警告 */}
        <div className="border border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/10 p-4 my-2">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <p className="text-[11px] font-semibold tracking-wider">セットアップ時の注意</p>
          </div>
          <ul className="text-[11px] text-muted-foreground space-y-1 pl-5 list-disc">
            <li>必ず <strong className="text-foreground">Chrome / Edge</strong> をご利用ください</li>
            <li>ZIPは <strong className="text-foreground">解凍してから</strong>「フォルダごと」読み込み</li>
            <li>サロンボードに<strong className="text-foreground">ログイン済みのタブ</strong>で実行</li>
            <li>スキャン中はサロンボードのタブを<strong className="text-foreground">触らない</strong></li>
          </ul>
        </div>

        {/* 免責同意 3項目 */}
        <div className="space-y-3 py-2">
          <p className="text-[11px] eyebrow text-muted-foreground">— 免責事項への同意 —</p>

          <label
            className={cn(
              "flex gap-3 p-3 border cursor-pointer transition-colors",
              c1 ? "border-gold bg-gold/5" : "border-border hover:border-gold/50"
            )}
          >
            <Checkbox
              checked={c1}
              onCheckedChange={(v) => setC1(v === true)}
              className="mt-0.5 rounded-none"
            />
            <span className="text-xs leading-relaxed">
              <strong>1. 非公式ツールであることの理解</strong>
              <br />
              本拡張機能はサロンボード（株式会社リクルート）の公式提供物ではなく、
              Salon Boost が独自に提供する補助ツールであることを理解しました。
            </span>
          </label>

          <label
            className={cn(
              "flex gap-3 p-3 border cursor-pointer transition-colors",
              c2 ? "border-gold bg-gold/5" : "border-border hover:border-gold/50"
            )}
          >
            <Checkbox
              checked={c2}
              onCheckedChange={(v) => setC2(v === true)}
              className="mt-0.5 rounded-none"
            />
            <span className="text-xs leading-relaxed">
              <strong>2. リスクの自己負担</strong>
              <br />
              ホットペッパービューティー利用規約により自動取得が制限される可能性があり、
              本拡張機能の使用に起因して<strong className="text-destructive">アカウント停止・契約解除等</strong>
              の措置を受けた場合の責任は<strong className="text-destructive">利用者自身</strong>が負うものとし、
              Salon Boost 運営はいかなる責任・補償も負わないことに同意します。
            </span>
          </label>

          <label
            className={cn(
              "flex gap-3 p-3 border cursor-pointer transition-colors",
              c3 ? "border-gold bg-gold/5" : "border-border hover:border-gold/50"
            )}
          >
            <Checkbox
              checked={c3}
              onCheckedChange={(v) => setC3(v === true)}
              className="mt-0.5 rounded-none"
            />
            <span className="text-xs leading-relaxed">
              <strong>3. 適正利用の遵守</strong>
              <br />
              本拡張で取得するデータは<strong>自店舗の顧客データに限定</strong>し、
              第三者提供・他店舗データ取得・大量自動アクセス等の不正利用には使用しません。
            </span>
          </label>
        </div>

        <div className="text-[10px] text-muted-foreground border-t border-border pt-3">
          ※ 同意内容は法的記録として日時・IPと共に保存されます（規約バージョン v1.0）。
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="rounded-none"
            onClick={() => onOpenChange(false)}
            disabled={downloading}
          >
            キャンセル
          </Button>
          <Button
            className="rounded-none bg-primary hover:bg-primary-glow disabled:opacity-40"
            onClick={handleConfirm}
            disabled={!allChecked || downloading}
          >
            {downloading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                ダウンロード中...
              </>
            ) : (
              "同意してダウンロード"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ExtensionDownloadConsentDialog;
