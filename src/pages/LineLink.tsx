import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getLineLinkConfig } from "@/lib/line-link-config";
import { buildLineOaMessageUrl } from "@/lib/lineLink";

type LiffApi = {
  init: (config: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  isInClient: () => boolean;
  getIDToken: () => string | null;
  getFriendship?: () => Promise<{ friendFlag: boolean }>;
};

declare global {
  interface Window {
    liff?: LiffApi;
  }
}

type OpenMode = "normal_browser" | "line_browser" | "liff";
type LinkState = "linking" | "success" | "error" | "config_required" | "open_in_line" | "manual";

const errorMessages: Record<string, string> = {
  invalid_token: "連携コードが見つかりません。QRを再度読み込んでください。",
  token_expired: "連携コードの有効期限が切れています。",
  token_used: "この連携コードは既に使用済みです。",
  line_user_conflict: "別の顧客がこのLINEアカウントと既に連携されています。",
  customer_already_linked: "別のLINEアカウントと既に連携されています。",
  liff_not_configured: "LINE連携設定が見つかりません。店舗スタッフへお知らせください。",
  liff_config_missing: "LINE連携設定が見つかりません。店舗スタッフへお知らせください。",
  liff_init_failed: "LINE連携画面の初期化に失敗しました。LINEアプリで開き直してください。",
  not_in_line_browser: "このLINE連携はLINEアプリ内で開く必要があります。",
  id_token_missing: "LINEの本人確認情報を取得できませんでした。",
  invalid_id_token: "LINEの本人確認に失敗しました。LINEアプリで開き直してください。",
  network_error: "通信に失敗しました。時間をおいて再度お試しください。",
  internal_error: "連携に失敗しました。店舗スタッフへお知らせください。",
  unknown_error: "連携に失敗しました。店舗スタッフへお知らせください。",
  liff_endpoint_misconfigured: "LIFF Endpoint URL設定が違う可能性があります。店舗スタッフへお知らせください。",
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

const getOpenMode = (openedFromLiff: boolean, openedInLineBrowser: boolean): OpenMode => {
  if (openedFromLiff) return "liff";
  if (openedInLineBrowser) return "line_browser";
  return "normal_browser";
};

const maskToken = (token: string) => (token ? `${token.slice(0, 3)}***` : null);

const buildLiffAutoLinkUrl = (liffId: string, token: string) =>
  `https://liff.line.me/${encodeURIComponent(liffId)}?token=${encodeURIComponent(token)}`;

const sanitizeCurrentUrl = (token: string) => {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) url.searchParams.set("token", maskToken(token) || "***");
    const liffState = url.searchParams.get("liff.state");
    if (liffState) {
      const normalizedState = liffState.startsWith("?") ? liffState.slice(1) : liffState;
      const stateParams = new URLSearchParams(normalizedState);
      if (stateParams.has("token")) stateParams.set("token", maskToken(token) || "***");
      url.searchParams.set("liff.state", `?${stateParams.toString()}`);
    }
    return url.toString();
  } catch {
    return window.location.pathname;
  }
};

const sanitizeUrlForLog = (value: string | null | undefined, token: string) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) url.searchParams.set("token", maskToken(token) || "***");
    const liffState = url.searchParams.get("liff.state");
    if (liffState) {
      const normalizedState = liffState.startsWith("?") ? liffState.slice(1) : liffState;
      const stateParams = new URLSearchParams(normalizedState);
      if (stateParams.has("token")) stateParams.set("token", maskToken(token) || "***");
      url.searchParams.set("liff.state", `?${stateParams.toString()}`);
    }
    return url.toString();
  } catch {
    return token ? value.replace(token, maskToken(token) || "***") : value;
  }
};

const warnLineLink = (
  nextAction: string,
  context: {
    mode: OpenMode;
    token: string;
    configured?: boolean;
    redirectTarget?: string | null;
  },
) => {
  console.warn("[line-link]", {
    openMode: context.mode,
    tokenExists: Boolean(context.token),
    tokenPrefix: maskToken(context.token),
    liffConfigured: context.configured ?? null,
    currentUrl: sanitizeCurrentUrl(context.token),
    pathname: window.location.pathname,
    search: sanitizeCurrentUrl(context.token).split("?")[1] ? `?${sanitizeCurrentUrl(context.token).split("?")[1]}` : "",
    redirectTarget: sanitizeUrlForLog(context.redirectTarget, context.token),
    nextAction,
  });
};

const LineLink = () => {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => getLinkToken(searchParams), [searchParams]);
  const openedFromLiff = useMemo(() => Boolean(searchParams.get("liff.state")), [searchParams]);
  const openedInLineBrowser = useMemo(() => /Line\//i.test(window.navigator.userAgent), []);
  const openMode = useMemo(() => getOpenMode(openedFromLiff, openedInLineBrowser), [openedFromLiff, openedInLineBrowser]);
  const [state, setState] = useState<LinkState>("linking");
  const [message, setMessage] = useState("連携中です");
  const [friendRequired, setFriendRequired] = useState(false);
  const [lineAddFriendUrl, setLineAddFriendUrl] = useState<string | null>(null);
  const [liffAutoLinkUrl, setLiffAutoLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const completeLink = async () => {
      if (!token) {
        warnLineLink("show_invalid_token", { mode: openMode, token });
        setState("error");
        setMessage(errorMessages.invalid_token);
        return;
      }

      try {
        const config = await getLineLinkConfig(token);
        const liffId = config.liffId;
        const nextLiffAutoLinkUrl = liffId ? buildLiffAutoLinkUrl(liffId, token) : null;
        const linkText = `連携:${token}`;
        const lineMessageUrl = buildLineOaMessageUrl(config.lineAddFriendUrl, linkText);
        setLineAddFriendUrl(lineMessageUrl || config.lineAddFriendUrl);
        setLiffAutoLinkUrl(nextLiffAutoLinkUrl);
        if (!liffId) {
          warnLineLink("show_manual_link_fallback", { mode: openMode, token, configured: false });
          setState("manual");
          setMessage(
            lineMessageUrl
              ? "下のボタンからLINE公式アカウントのトークを開き、入力済みの連携コードを送信してください。"
              : "下の連携コードをコピーして、LINE公式アカウントのトークに送信してください。"
          );
          return;
        }

        if (!openedFromLiff) {
          warnLineLink("show_open_in_line_fallback", {
            mode: openMode,
            token,
            configured: true,
            redirectTarget: nextLiffAutoLinkUrl,
          });
          setState("open_in_line");
          setMessage(errorMessages.not_in_line_browser);
          return;
        }

        let liff: LiffApi;
        try {
          liff = await loadLiffSdk();
        } catch (error) {
          console.warn("Failed to load LIFF SDK", error);
          warnLineLink("show_liff_init_failed", { mode: openMode, token, configured: true });
          setState("error");
          setMessage(`${errorMessages.liff_init_failed} ${errorMessages.liff_endpoint_misconfigured}`);
          return;
        }
        if (cancelled) return;

        try {
          await liff.init({ liffId });
        } catch (error) {
          console.warn("Failed to initialize LIFF", error);
          warnLineLink("show_liff_init_failed", { mode: openMode, token, configured: true });
          setState("error");
          setMessage(`${errorMessages.liff_init_failed} ${errorMessages.liff_endpoint_misconfigured}`);
          return;
        }
        if (cancelled) return;

        if (!liff.isInClient()) {
          warnLineLink("show_not_in_line_browser", { mode: openMode, token, configured: true });
          setState("open_in_line");
          setMessage(`${errorMessages.not_in_line_browser} ${errorMessages.liff_endpoint_misconfigured}`);
          return;
        }

        if (!liff.isLoggedIn()) {
          warnLineLink("show_not_logged_in", { mode: openMode, token, configured: true });
          setState("error");
          setMessage("LINEアプリ内でログイン状態を確認できませんでした。LINEで開き直してください。");
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          warnLineLink("show_id_token_missing", { mode: openMode, token, configured: true });
          setState("error");
          setMessage(errorMessages.id_token_missing);
          return;
        }

        const { data, error } = await supabase.functions.invoke("line-link-complete", {
          body: { token, idToken },
        });

        if (cancelled) return;
        if (error) {
          console.warn("line-link-complete network error", error);
          warnLineLink("show_network_error", { mode: openMode, token, configured: true });
          setState("error");
          setMessage(errorMessages.network_error);
          return;
        }
        if (!data?.success) {
          const errorCode = typeof data?.error === "string" ? data.error : "unknown_error";
          warnLineLink(`show_${errorCode}`, { mode: openMode, token, configured: true });
          setState("error");
          setMessage(errorMessages[errorCode] || errorMessages.unknown_error);
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
          warnLineLink("show_unknown_error", {
            mode: openMode,
            token,
            configured: false,
          });
          setState("error");
          setMessage(errorMessages.unknown_error);
        }
      }
    };

    completeLink();
    return () => {
      cancelled = true;
    };
  }, [openMode, openedFromLiff, token]);

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

        {(state === "open_in_line" || state === "manual") && (
          <div className="mt-6 space-y-3">
            <p className="text-xs leading-6 text-muted-foreground">
              下のボタンが表示されている場合は、LINE公式アカウントのトークを開いて連携コードを送信してください。
              うまく開けない場合は、連携コードをLINE公式アカウントのトークへ送信してください。
            </p>
            {state === "open_in_line" && liffAutoLinkUrl && (
              <Button asChild className="w-full rounded-none bg-[#06C755] text-white hover:bg-[#05b84f]">
                <a href={liffAutoLinkUrl}>LINEで自動連携する</a>
              </Button>
            )}
            {lineAddFriendUrl && (
              <Button asChild variant="outline" className="w-full rounded-none">
                <a href={lineAddFriendUrl}>LINE公式アカウントを開く</a>
              </Button>
            )}
          </div>
        )}

        {friendRequired && (
          <div className="mt-4 border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800">
            友だち追加が必要な場合は、LINE公式アカウントを友だち追加してください。
          </div>
        )}

        {(state === "error" || state === "config_required" || state === "open_in_line" || state === "manual") && token && (
          <div className="mt-6 space-y-3">
            <p className="text-xs leading-6 text-muted-foreground">
              うまく開けない場合は、下の連携コードをLINE公式アカウントのトークへ送信してください。
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
