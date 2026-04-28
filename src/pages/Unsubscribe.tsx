import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "valid" | "already" | "invalid" | "submitting" | "done" | "error">("loading");

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, {
          headers: { apikey: SUPABASE_KEY },
        });
        const data = await res.json();
        if (data.valid) setState("valid");
        else if (data.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      } catch { setState("invalid"); }
    })();
  }, [token]);

  const confirm = async () => {
    setState("submitting");
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    if (error || !data?.success) setState("error");
    else setState("done");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-8 py-16">
        <p className="eyebrow text-[10px] tracking-luxury text-gold">— EMAIL PREFERENCES —</p>
        <h1 className="display text-3xl">配信停止</h1>

        {state === "loading" && <Loader2 className="w-6 h-6 animate-spin mx-auto text-gold" />}

        {state === "valid" && (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              今後このメールアドレスへの配信を停止します。よろしいですか？
            </p>
            <Button onClick={confirm} className="rounded-none px-12 py-6 text-xs tracking-luxury">
              配信を停止する <span className="ml-2 opacity-60 text-[10px]">UNSUBSCRIBE</span>
            </Button>
          </>
        )}

        {state === "submitting" && <Loader2 className="w-6 h-6 animate-spin mx-auto text-gold" />}

        {state === "done" && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            配信を停止しました。<br />ご利用ありがとうございました。
          </p>
        )}

        {state === "already" && (
          <p className="text-sm text-muted-foreground">既に配信停止済みです。</p>
        )}

        {state === "invalid" && (
          <p className="text-sm text-muted-foreground">リンクが無効か、有効期限が切れています。</p>
        )}

        {state === "error" && (
          <p className="text-sm text-destructive">エラーが発生しました。時間をおいて再度お試しください。</p>
        )}
      </div>
    </div>
  );
};

export default Unsubscribe;
