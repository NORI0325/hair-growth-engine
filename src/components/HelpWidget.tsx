import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, X, Send, BookOpen, MessageCircleQuestion, Mail, Loader2, ChevronLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; related?: { slug: string; title: string }[] };
type View = "menu" | "chat" | "ticket";

// 浮遊型ヘルプウィジェット
const HelpWidget = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);

  // ticket form
  const [tSubject, setTSubject] = useState("");
  const [tMessage, setTMessage] = useState("");
  const [tSending, setTSending] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, view]);

  // Allow other pages to open the chat with a prefilled question
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { prefill?: string } | undefined;
      setOpen(true);
      setView("chat");
      if (detail?.prefill) setInput(detail.prefill);
    };
    window.addEventListener("help:openchat", handler);
    return () => window.removeEventListener("help:openchat", handler);
  }, []);

  // 公開ページでは表示しない
  if (!user) return null;
  if (pathname.startsWith("/book/") || pathname.startsWith("/salon/") || pathname.startsWith("/my-bookings/")) return null;

  const sendChat = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-help-assistant", {
        body: {
          message: text,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          route: pathname,
          sessionId: sessionIdRef.current,
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.message || "AIサポートが応答できませんでした");
        setMessages([...next, { role: "assistant", content: "申し訳ございません、現在AIが応答できません。『人に聞く』からお問い合わせください。" }]);
      } else {
        setMessages([...next, { role: "assistant", content: data.reply, related: data.related }]);
      }
    } catch (e) {
      console.error(e);
      toast.error("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const submitTicket = async () => {
    if (!tSubject.trim() || !tMessage.trim()) {
      toast.error("件名と本文を入力してください");
      return;
    }
    setTSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-support-ticket", {
        body: {
          subject: tSubject,
          message: tMessage,
          route: pathname,
          aiChatHistory: messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("お問い合わせを送信しました。1〜2営業日以内にご返信します。");
      setTSubject("");
      setTMessage("");
      setView("menu");
    } catch (e: any) {
      toast.error(e.message || "送信に失敗しました");
    } finally {
      setTSending(false);
    }
  };

  return (
    <>
      {/* 浮遊ボタン */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-[hsl(var(--gold))] to-[hsl(var(--gold))]/80 text-background shadow-2xl hover:scale-105 transition-transform flex items-center justify-center"
          aria-label="ヘルプを開く"
          data-tour="help-widget"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {/* パネル */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
          {/* header */}
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-sidebar text-sidebar-foreground">
            {view !== "menu" && (
              <button onClick={() => setView("menu")} className="text-sidebar-foreground/70 hover:text-sidebar-foreground">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="flex-1">
              <p className="eyebrow text-[9px] text-gold">— Support —</p>
              <p className="font-serif text-sm">
                {view === "menu" && "ヘルプ"}
                {view === "chat" && "AIサポート"}
                {view === "ticket" && "人に聞く"}
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="text-sidebar-foreground/70 hover:text-sidebar-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* body */}
          {view === "menu" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <p className="text-sm text-muted-foreground">何かお困りですか？</p>
              <button
                onClick={() => setView("chat")}
                className="w-full text-left p-4 border border-border rounded-md hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-gold" />
                  <div>
                    <p className="font-serif text-sm">AIに質問する</p>
                    <p className="text-xs text-muted-foreground mt-0.5">マニュアルを学習したAIが即答します</p>
                  </div>
                </div>
              </button>
              <Link
                to="/help"
                onClick={() => setOpen(false)}
                className="block w-full text-left p-4 border border-border rounded-md hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <BookOpen className="w-5 h-5 text-gold" />
                  <div>
                    <p className="font-serif text-sm">マニュアルを見る</p>
                    <p className="text-xs text-muted-foreground mt-0.5">機能別の使い方ガイド</p>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => setView("ticket")}
                className="w-full text-left p-4 border border-border rounded-md hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-gold" />
                  <div>
                    <p className="font-serif text-sm">人に聞く</p>
                    <p className="text-xs text-muted-foreground mt-0.5">サポートチームへメールで問い合わせ</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {view === "chat" && (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <MessageCircleQuestion className="w-8 h-8 mx-auto mb-2 text-gold" />
                    <p>このアプリの使い方を何でも聞いてください</p>
                    <div className="mt-4 space-y-2">
                      {["予約取込メールってどう設定するの？", "VIPはどう判定されますか？", "再活性化の文面を変えたい"].map((q) => (
                        <button
                          key={q}
                          onClick={() => { setInput(q); }}
                          className="block w-full text-xs px-3 py-2 border border-border rounded hover:bg-accent text-left"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                        m.role === "user" ? "bg-gold text-background" : "bg-muted text-foreground"
                      )}
                    >
                      {m.role === "assistant" ? (
                        <div className="prose prose-sm max-w-none [&_p]:my-1 [&_ol]:my-1 [&_ul]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-serif [&_h2]:font-serif">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                      {m.related && m.related.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                          <p className="text-[10px] text-muted-foreground eyebrow">関連マニュアル</p>
                          {m.related.map((r) => (
                            <Link
                              key={r.slug}
                              to={`/help/${r.slug}`}
                              onClick={() => setOpen(false)}
                              className="block text-xs text-gold hover:underline"
                            >
                              › {r.title}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gold" />
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-border p-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                    placeholder="質問を入力..."
                    disabled={loading}
                    className="text-sm"
                  />
                  <Button onClick={sendChat} disabled={loading || !input.trim()} size="icon" className="shrink-0">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                <button
                  onClick={() => setView("ticket")}
                  className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
                >
                  解決しない場合はこちら → 人に聞く
                </button>
              </div>
            </>
          )}

          {view === "ticket" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <p className="text-sm text-muted-foreground">サポートチームにメールで送信します。1〜2営業日以内にご返信します。</p>
              <div className="space-y-2">
                <label className="text-xs eyebrow">件名</label>
                <Input value={tSubject} onChange={(e) => setTSubject(e.target.value)} placeholder="例：予約取込が動かない" />
              </div>
              <div className="space-y-2">
                <label className="text-xs eyebrow">内容</label>
                <Textarea value={tMessage} onChange={(e) => setTMessage(e.target.value)} placeholder="状況をできるだけ詳しくお書きください" rows={6} />
              </div>
              {messages.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  ※ 直前のAIチャット履歴と現在の画面情報も自動で添付されます
                </p>
              )}
              <Button onClick={submitTicket} disabled={tSending} className="w-full">
                {tSending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                送信する
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default HelpWidget;
