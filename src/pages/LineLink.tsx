import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

type LiffApi = {
  init: (config: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (config?: { redirectUri?: string }) => void;
  getIDToken: () => string | null;
  getFriendship?: () => Promise<{ friendFlag: boolean }>;
};

declare global {
  interface Window {
    liff?: LiffApi;
  }
}

type LinkState = "linking" | "success" | "error" | "config_required";

const liffId = import.meta.env.VITE_LINE_LIFF_ID as string | undefined;

const errorMessages: Record<string, string> = {
  invalid_token: "連携コードが正しくありません。",
  token_expired: "連携コードの有効期限が切れています。",
  token_used: "この連携コードは既に使用済みです。",
  line_user_conflict: "別の顧客がこのLINEアカウントと既に連携されています。",
  customer_already_linked: "別のLINEアカウントと既に連携されています。",
  liff_not_configured: "連携に失敗しました。店舗スタッフへお知らせください。",
  id_token_missing: "LINEの本人確認情報を取得できませんでした。",
};

const getLinkToken = (searchParams: URLSearchParams) => {
  const directToken = (searchParams.get("token") || "").trim();
  if (directToken) return directToken.toUpperCase();

  const liffState = searchParams.get("liff.state") || "";
  if (!liffState) return "";

  const normalizedState = liffState.startsWith("?") ? liffState.slice(1) : liffState;
  const stateParams = new URLSearchParams(normalizedState);
  return (stateParams.get("token") || "").trim().toUpperCase();
};

const loadLiffSdk = () => {
  return new Promise<LiffApi>((resolve, reject) => {
    if (window.liff) {
      resolve(window.liff);
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>("script[data-line-liff-sdk='true']");
    if (existingScript) {
      existingScript.addEventListener("load", () => (window.liff ? resolve(window.liff) : reject(new Error("LIFF SDK not available"))), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load LIFF SDK")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    script.async = true;
    script.dataset.lineLiffSdk = "true";
    script.onload = () => (window.liff ? resolve(window.liff) : reject(new Error("LIFF SDK not available")));
    script.onerror = () => reject(new Error("Failed to load LIFF SDK"));
    document.head.appendChild(script);
  });
};

const LineLink = () => {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => getLinkToken(searchParams), [searchParams]);
  const [state, setState] = useState<LinkState>("linking");
  const [message, setMessage] = useState("連携中です");
  const [friendRequired, setFriendRequired] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const completeLink = async () => {
      if (!token) {
        setState("error");
        setMessage(errorMessages.invalid_token);
        return;
      }

      if (!liffId) {
        setState("config_required");
        setMessage("LIFF IDが未設定です。店舗スタッフへお知らせください。");
        return;
      }

      try {
        const liff = await loadLiffSdk();
        if (cancelled) return;

        await liff.init({ liffId });
        if (cancelled) return;

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          setState("error");
          setMessage(errorMessages.id_token_missing);
          return;
        }

        const { data, error } = await supabase.functions.invoke("line-link-complete", {
          body: { token, idToken },
        });

        if (cancelled) return;
        if (error) throw error;
        if (!data?.success) {
          setState("error");
          setMessage(errorMessages[data?.error] || "連携に失敗しました。店舗スタッフへお知らせください。");
          return;
        }

        if (liff.getFriendship) {
          try {
            const friendship = await liff.getFriendship();
            if (!friendship.friendFlag) setFriendRequired(true);
          } catch (friendshipError) {
            console.warn("Failed to check LINE friendship", friendshipError);
          }
        }

        setState("success");
        setMessage("LINE連携が完了しました。");
      } catch (error) {
        console.error("LINE link failed", error);
        if (!cancelled) {
          setState("error");
          setMessage("連携に失敗しました。店舗スタッフへお知らせください。");
        }
      }
    };

    completeLink();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const copyFallbackCode = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(`連携:${token}`);
    setCopied(true);
    toast.success("連携コードをコピーしました");
    setTimeout(() => setCopied(false), 2000);
  };

  const isSuccess = state === "success";
  const isLinking = state === "linking";

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-md border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-border bg-secondary/40">
            {isLinking ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : isSuccess ? (
              <CheckCircle2 className="h-5 w-5 text-[#06C755]" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
          </div>
          <div>
            <p className="eyebrow text-[#06C755]">LINE Link</p>
            <h1 className="display text-2xl">LINE連携</h1>
          </div>
        </div>

        <p className="text-sm leading-7 text-foreground">{message}</p>

        {friendRequired && (
          <div className="mt-4 border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800">
            友だち追加が必要な場合は、LINE公式アカウントを友だち追加してください。
          </div>
        )}

        {(state === "error" || state === "config_required") && token && (
          <div className="mt-6 space-y-3">
            <p className="text-xs leading-6 text-muted-foreground">
              自動連携ができない場合は、下の連携コードをLINE公式アカウントのトークへ送信してください。
            </p>
            <div className="flex items-stretch border border-border">
              <div className="flex-1 bg-secondary/30 px-4 py-3 font-mono text-sm">連携:{token}</div>
              <Button onClick={copyFallbackCode} variant="ghost" className="rounded-none border-l border-border px-4">
                {copied ? "コピー済み" : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}

        {isSuccess && (
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            この画面は閉じてかまいません。反映されない場合は、店舗スタッフへお知らせください。
          </p>
        )}
      </section>
    </main>
  );
};

export default LineLink;
