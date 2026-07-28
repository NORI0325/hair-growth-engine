import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenant";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import LocalQrCode from "@/components/LocalQrCode";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const Share = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [salonName, setSalonName] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!tenantId) return;
      const { data } = await supabase
        .from("profiles")
        .select("public_slug, salon_name")
        .eq("id", tenantId)
        .maybeSingle();
      if (data) {
        setSlug(data.public_slug || "");
        setSalonName(data.salon_name || "");
      }
      setLoading(false);
    };
    load();
  }, [tenantId]);

  const url = slug ? `https://saronboost.com/salon/${slug}` : "";

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("URLをコピーしました");
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return (
    <AppLayout>
      <div className="py-24 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" /></div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.06 — Share"
        title="公開予約URL"
        description="新規のお客様も予約できる、サロン専用の公開URLです"
      />

      <div className="grid lg:grid-cols-2 gap-12 mt-10">
        <div className="space-y-8">
          <div>
            <p className="eyebrow mb-3">— 公開予約URL / Public Reservation —</p>
            <div className="flex items-stretch border border-border">
              <div className="flex-1 px-5 py-4 font-serif-en text-sm break-all bg-secondary/30">{url}</div>
              <Button onClick={copy} variant="ghost" className="rounded-none border-l border-border px-5">
                {copied ? <Check className="w-4 h-4 text-gold" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs eyebrow text-gold mt-4 hover:underline">
              <ExternalLink className="w-3 h-3" /> プレビューを開く
            </a>
          </div>

          <div className="border-t border-border pt-8">
            <p className="eyebrow mb-4">— 活用方法 / How To Use —</p>
            <ul className="space-y-4 text-sm font-serif text-muted-foreground leading-relaxed">
              <li className="flex gap-4">
                <span className="font-serif-en text-gold">01</span>
                <span>InstagramのプロフィールやGoogleマップに、このURLを貼り付けて新規集客</span>
              </li>
              <li className="flex gap-4">
                <span className="font-serif-en text-gold">02</span>
                <span>QRコードを店頭・名刺・チラシに印刷して、その場で予約をいただく</span>
              </li>
              <li className="flex gap-4">
                <span className="font-serif-en text-gold">03</span>
                <span>新規予約は自動的に顧客リストに追加され、リマインドメールの対象になります</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border border-border p-12 flex flex-col items-center justify-center bg-secondary/30">
          <p className="eyebrow mb-6 text-gold">— スキャンで予約 / Scan to Reserve —</p>
          <div className="font-serif text-base mb-6">{salonName}</div>
          {url && <LocalQrCode value={url} title="予約用QRコード" className="w-64 h-64 bg-white p-3" />}
          <p className="text-xs text-muted-foreground mt-6 tracking-wider">店頭・名刺・チラシ用</p>
          <p className="text-xs text-muted-foreground mt-3">印刷する場合はブラウザの印刷機能をご利用ください</p>
        </div>
      </div>
    </AppLayout>
  );
};

export default Share;
