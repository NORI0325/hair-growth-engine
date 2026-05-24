import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import LocalQrCode from "@/components/LocalQrCode";
import { getLineLinkConfig } from "@/lib/line-link-config";

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
  const [liffId, setLiffId] = useState<string | null>(null);
  const [configUnavailable, setConfigUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      setLoading(true);
      setConfigUnavailable(false);

      const configPromise = getLineLinkConfig()
        .then((config) => setLiffId(config.liffId))
        .catch((error) => {
          console.warn("Failed to load LIFF config", error);
          setLiffId(null);
          setConfigUnavailable(true);
        });

      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("id, owner_id, full_name, line_user_id, line_unfollowed_at")
        .eq("id", customerId)
        .maybeSingle();

      if (customerError || !customer) {
        toast.error("顧客情報の取得に失敗しました");
        await configPromise;
        setLoading(false);
        return;
      }

      const { data: existing } = await supabase
        .from("customer_line_link_tokens")
        .select("token, expires_at, used_at")
        .eq("owner_id", customer.owner_id)
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
          .insert({ owner_id: customer.owner_id, customer_id: customerId })
          .select("token")
          .maybeSingle();

        if (error) toast.error("連携コードの作成に失敗しました: " + error.message);
        else setToken(created?.token || "");
      }

      await configPromise;
      setLoading(false);
    })();
  }, [open, user, customerId]);

  const linkText = token ? `連携:${token}` : "連携:";
  const appLinkUrl = token ? `${window.location.origin}/line-link?token=${encodeURIComponent(token)}` : "";
  const liffLinkUrl = token && liffId ? `https://liff.line.me/${encodeURIComponent(liffId)}?token=${encodeURIComponent(token)}` : "";
  const qrData = liffLinkUrl || appLinkUrl || linkText;

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(linkText);
    setCopied(true);
    toast.success("連携コードをコピーしました");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none max-w-md">
        <DialogHeader>
          <p className="eyebrow mb-2 text-[#06C755]">LINE Link</p>
          <DialogTitle className="display text-2xl">LINE連携QR</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{customerName}</span> 様専用のLINE連携QRです。
            QRを読み込むと連携ページが開きます。LIFF設定済みの場合は、LINE上で確認するだけで顧客情報と紐づきます。
          </p>

          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : (
            <>
              <div className="flex justify-center bg-secondary/30 p-6 border border-border">
                <LocalQrCode value={qrData} title="LINE連携QR" className="w-56 h-56 bg-white p-2" />
              </div>

              {!liffId && (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-3">
                  {configUnavailable
                    ? "LIFF設定を取得できませんでした。QRはアプリ内の連携ページを開きます。自動連携にはLINE_LIFF_ID設定が必要です。"
                    : "LIFF IDが未設定のため、QRはアプリ内の連携ページを開きます。自動連携を有効にするにはLINE_LIFF_IDを設定してください。"}
                </div>
              )}

              <div>
                <p className="text-[11px] eyebrow mb-2">Fallback Link Code</p>
                <div className="flex items-stretch border border-border">
                  <div className="flex-1 px-4 py-3 font-mono text-sm bg-secondary/30">{linkText}</div>
                  <Button onClick={copyToken} variant="ghost" className="rounded-none border-l border-border px-4">
                    {copied ? <Check className="w-4 h-4 text-gold" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  QR連携が使えない場合は、この連携コードをLINE公式アカウントのトークへ送信してください。既存方式はfallbackとして残しています。
                </p>
              </div>

              {lineAddFriendUrl && (
                <Button asChild variant="outline" className="w-full rounded-none">
                  <a href={lineAddFriendUrl} target="_blank" rel="noreferrer">
                    LINE公式アカウントを開く
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </a>
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LineLinkQRDialog;
