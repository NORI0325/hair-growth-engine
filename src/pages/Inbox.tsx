import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageCircle, Check, AlertTriangle, Sparkles, Phone, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { CustomerMessageDialog } from "@/components/CustomerMessageDialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { useCurrentLocationId } from "@/hooks/useLocations";

interface InboundMsg {
  id: string;
  customer_id: string | null;
  line_user_id: string;
  display_name: string | null;
  message_text: string;
  intent: string | null;
  urgency: string;
  summary: string | null;
  suggested_action: string | null;
  ai_processed: boolean;
  handled: boolean;
  handled_at: string | null;
  created_at: string;
}

const INTENT_LABELS: Record<string, string> = {
  booking_request: "新規予約", reschedule: "日時変更", cancel: "キャンセル",
  question: "質問", complaint: "クレーム", thanks: "お礼",
  chitchat: "雑談", other: "その他",
};

const URGENCY_STYLES: Record<string, { label: string; className: string }> = {
  critical: { label: "🚨 緊急", className: "bg-red-500/10 text-red-600 border-red-500/30" },
  high: { label: "⚠️ 要対応", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  normal: { label: "通常", className: "bg-secondary text-foreground/70 border-border" },
  low: { label: "低", className: "bg-muted text-muted-foreground border-border" },
};

export default function Inbox() {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const [messages, setMessages] = useState<InboundMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"unhandled" | "all" | "critical">("unhandled");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<InboundMsg | null>(null);

  const load = async () => {
    if (!user || !locationId) { setMessages([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase
      .from("line_inbound_messages")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter === "unhandled") q = q.eq("handled", false);
    if (filter === "critical") q = q.eq("urgency", "critical").eq("handled", false);
    const { data } = await q;
    setMessages(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!user || !locationId) return;
    const ch = supabase
      .channel("inbox-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "line_inbound_messages", filter: `location_id=eq.${locationId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filter, locationId]);

  const markHandled = async (id: string, handled: boolean) => {
    const { error } = await supabase
      .from("line_inbound_messages")
      .update({ handled, handled_at: handled ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) { toast.error("更新に失敗しました"); return; }
    toast.success(handled ? "対応済みにしました" : "未対応に戻しました");
  };

  const removeMessage = async (id: string) => {
    const { error } = await supabase.from("line_inbound_messages").delete().eq("id", id);
    if (error) { toast.error("削除に失敗しました: " + error.message); return; }
    toast.success("メッセージを削除しました");
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const openReply = (m: InboundMsg) => {
    if (!m.customer_id) {
      toast.error("LINE未連携のお客様です。対応後、お客様情報と紐付けてください。");
      return;
    }
    setReplyTo(m);
    setReplyOpen(true);
  };

  const counts = {
    unhandled: messages.filter(m => !m.handled).length,
    critical: messages.filter(m => m.urgency === "critical" && !m.handled).length,
  };

  return (
    <AppLayout>
      <PageHeader
        title="受信トレイ"
        eyebrow="LINE Inbox"
        description="お客様からのLINEメッセージをAIが意図と緊急度で自動分類しています。"
      />

      {/* フィルタータブ */}
      <div className="flex gap-2 mb-6 border-b border-border">
        {[
          { k: "unhandled", l: "未対応", c: counts.unhandled },
          { k: "critical", l: "🚨 緊急のみ", c: counts.critical },
          { k: "all", l: "すべて", c: null },
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setFilter(t.k as any)}
            className={`px-4 py-2.5 text-sm font-serif tracking-wider transition-all border-b-2 -mb-px ${
              filter === t.k ? "border-gold text-gold" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.l} {t.c !== null && t.c > 0 && <span className="ml-1 text-[10px] opacity-70">({t.c})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" /></div>
      ) : messages.length === 0 ? (
        <Card className="rounded-none border-border p-16 text-center">
          <MessageCircle className="w-10 h-10 mx-auto text-muted-foreground/40 mb-4" />
          <p className="font-serif text-sm text-muted-foreground">
            {filter === "unhandled" ? "未対応のメッセージはありません" : "メッセージはありません"}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map(m => {
            const u = URGENCY_STYLES[m.urgency] || URGENCY_STYLES.normal;
            return (
              <Card key={m.id} className={`rounded-none border-l-2 transition-all ${
                m.handled ? "opacity-50 border-l-border" :
                m.urgency === "critical" ? "border-l-red-500" :
                m.urgency === "high" ? "border-l-amber-500" :
                "border-l-gold/30"
              }`}>
                <div className="p-5 space-y-3">
                  {/* ヘッダ */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`rounded-none ${u.className}`}>
                        {u.label}
                      </Badge>
                      {m.intent && (
                        <Badge variant="outline" className="rounded-none">
                          {INTENT_LABELS[m.intent] || m.intent}
                        </Badge>
                      )}
                      {!m.ai_processed && (
                        <Badge variant="outline" className="rounded-none text-muted-foreground">
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />AI分析中…
                        </Badge>
                      )}
                      {!m.customer_id && (
                        <Badge variant="outline" className="rounded-none border-amber-500/40 text-amber-600">
                          未連携
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {format(new Date(m.created_at), "MM/dd HH:mm")}
                    </div>
                  </div>

                  {/* お客様名 */}
                  <div className="font-serif text-sm">
                    {m.display_name || "お客様"}
                  </div>

                  {/* AI要約 */}
                  {m.summary && (
                    <div className="flex items-start gap-2 text-sm">
                      <Sparkles className="w-3.5 h-3.5 text-gold mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-muted-foreground text-[10px] uppercase tracking-wider mr-2">AI要約</span>
                        {m.summary}
                      </div>
                    </div>
                  )}

                  {/* 推奨アクション */}
                  {m.suggested_action && (
                    <div className="flex items-start gap-2 text-sm bg-secondary/30 px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-gold mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-muted-foreground text-[10px] uppercase tracking-wider mr-2">推奨対応</span>
                        {m.suggested_action}
                      </div>
                    </div>
                  )}

                  {/* 本文 */}
                  <div className="border-l-2 border-border pl-4 py-1 text-sm whitespace-pre-wrap text-foreground/80">
                    {m.message_text}
                  </div>

                  {/* アクション */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                    {m.customer_id ? (
                      <Button size="sm" onClick={() => openReply(m)} className="rounded-none">
                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                        AI下書きで返信
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" />お客様情報と紐付け後に返信可
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markHandled(m.id, !m.handled)}
                      className="rounded-none ml-auto"
                    >
                      <Check className="w-3.5 h-3.5 mr-1.5" />
                      {m.handled ? "未対応に戻す" : "対応済みにする"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-none text-muted-foreground hover:text-destructive"
                          title="メッセージを削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-none">
                        <AlertDialogHeader>
                          <AlertDialogTitle>このメッセージを削除しますか？</AlertDialogTitle>
                          <AlertDialogDescription>
                            受信トレイから完全に削除されます。この操作は取り消せません。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="rounded-none">キャンセル</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => removeMessage(m.id)}
                            className="rounded-none bg-destructive hover:bg-destructive/90"
                          >
                            削除する
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {replyTo && (
        <CustomerMessageDialog
          open={replyOpen}
          onClose={() => { setReplyOpen(false); markHandled(replyTo.id, true); setReplyTo(null); }}
          customerId={replyTo.customer_id!}
          customerName={replyTo.display_name || "お客様"}
          customerPhone={null}
          hasLine={true}
        />
      )}
    </AppLayout>
  );
}
