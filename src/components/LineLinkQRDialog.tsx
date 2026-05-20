import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  customerName: string;
  lineAddFriendUrl?: string | null;
}

const LineLinkQRDialog = ({ open, onOpenChange, customerId, customerName, lineAddFriendUrl }: Props) => {
  const { user } = useAuth();
  const [token, setToken] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      setLoading(true);
      // 1) 対象 customer の owner_id を取得（INSERT/SELECT 共に customer.owner_id を使う）
      const { data: customer, error: cErr } = await supabase
        .from("customers")
        .select("id, owner_id, full_name, line_user_id, line_unfollowed_at")
        .eq("id", customerId)
        .maybeSingle();
      if (cErr || !customer) {
        toast.error("顧客情報の取得に失敗しました");
        setLoading(false);
        return;
      }
      const ownerId = customer.owner_id;

      // 2) 既存の未使用トークンを再利用
      const { data: existing } = await supabase
        .from("customer_line_link_tokens")
        .select("token, expires_at, used_at")
        .eq("owner_id", ownerId)
        .eq("customer_id", customerId)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        setToken(existing.token);
      } else {
        const { data: created, error } = await supabase
          .from("customer_line_link_tokens")
          .insert({ owner_id: ownerId, customer_id: customerId })
          .select("token")
          .maybeSingle();
        if (error) toast.error("トークン生成に失敗: " + error.message);
        else setToken(created?.token || "");
      }
      setLoading(false);
    })();
  }, [open, user, customerId]);

  const linkText = `連携:${token}`;
  // LINE公式の友だち追加URLが設定されていれば、そこに自動で連携メッセージを開く
  const lineUrl = lineAddFriendUrl || "";
  const qrData = lineUrl
    ? lineUrl // 友だち追加QR（連携コードは送信ガイドで案内）
    : linkText;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(qrData)}`;

  const copyToken = async () => {
    await navigator.clipboard.writeText(linkText);
    setCopied(true);
    toast.success("連携コードをコピーしました");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none max-w-md">
        <DialogHeader>
          <p className="eyebrow mb-2 text-[#06C755]">— LINE Link —</p>
          <DialogTitle className="display text-2xl">LINE個別連携QR</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{customerName}</span> 様専用のQRコードです。
            お客様がこのQRを読み取り → 友だち追加 → 下の連携コードをトークに送信すると、
            自動で顧客カードと紐付きます（電話番号入力は不要）。
          </p>
          {loading ? (
            <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : (
            <>
              <div className="flex justify-center bg-secondary/30 p-6 border border-border">
                <img src={qrSrc} alt="LINE連携QR" className="w-56 h-56 bg-white p-2" />
              </div>
              <div>
                <p className="text-[11px] eyebrow mb-2">— 連携コード / Link Code —</p>
                <div className="flex items-stretch border border-border">
                  <div className="flex-1 px-4 py-3 font-mono text-sm bg-secondary/30">{linkText}</div>
                  <Button onClick={copyToken} variant="ghost" className="rounded-none border-l border-border px-4">
                    {copied ? <Check className="w-4 h-4 text-gold" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  ※ 30日間有効・1回限り。使用済みになると自動的に無効化されます。
                </p>
              </div>
              {!lineAddFriendUrl && (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-3">
                  💡 設定 → 連携 で「LINE友だち追加URL」を登録すると、QRから直接友だち追加トーク画面に飛べます。
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LineLinkQRDialog;
