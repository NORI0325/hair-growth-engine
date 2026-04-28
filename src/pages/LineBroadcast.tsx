import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, MessageCircle, History, Sparkles, BookmarkPlus, BookOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";

type LogRow = {
  id: string;
  job_type: string;
  message: string;
  status: string;
  error: string | null;
  created_at: string;
  customer_id: string | null;
};

const segments = [
  { value: "all",      label: "全員",         desc: "LINE登録済みの全顧客" },
  { value: "active",   label: "アクティブ",   desc: "90日以内に来店" },
  { value: "at_risk",  label: "離脱予備軍",   desc: "90〜180日来店なし" },
  { value: "dormant",  label: "休眠",         desc: "180日以上来店なし" },
];

const LineBroadcast = () => {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [segment, setSegment] = useState("all");
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [saveTitle, setSaveTitle] = useState("");
  const [showLib, setShowLib] = useState(false);
  const [showSave, setShowSave] = useState(false);

  const loadLogs = async () => {
    if (!user) return;
    setLoadingLogs(true);
    const { data } = await supabase
      .from("line_message_log" as any)
      .select("id, job_type, message, status, error, created_at, customer_id")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs((data as any) || []);
    setLoadingLogs(false);
  };

  const loadTemplates = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("line_templates")
      .select("*")
      .eq("owner_id", user.id)
      .order("use_count", { ascending: false });
    setTemplates(data || []);
  };

  const loadCounts = async () => {
    if (!user) return;
    const { data: all } = await supabase.from("customers")
      .select("id, last_visit_date", { count: "exact" })
      .eq("owner_id", user.id).eq("is_test", false)
      .not("line_user_id", "is", null);
    const list = all || [];
    const today = new Date();
    const dayAgo = (n: number) => {
      const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0];
    };
    const c90 = dayAgo(90), c180 = dayAgo(180);
    setCounts({
      all: list.length,
      active: list.filter(c => c.last_visit_date && c.last_visit_date >= c90).length,
      at_risk: list.filter(c => c.last_visit_date && c.last_visit_date >= c180 && c.last_visit_date < c90).length,
      dormant: list.filter(c => !c.last_visit_date || c.last_visit_date < c180).length,
    });
  };

  useEffect(() => { loadLogs(); loadCounts(); }, [user]);

  const broadcast = async () => {
    if (!message.trim()) { toast.error("メッセージを入力してください"); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("line-broadcast", {
      body: { message, segment },
    });
    setSending(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "送信に失敗しました");
      return;
    }
    const d = data as any;
    toast.success(`✅ ${d.sent}名へ送信しました（失敗 ${d.failed}名 / 対象 ${d.total}名）`);
    setMessage("");
    loadLogs();
  };

  const jobTypeLabel: Record<string, string> = {
    thank_you: "サンクス",
    aftercare: "ヘアケア案内（7日後）",
    next_suggestion: "次回提案（30日後）",
    reminder: "前日リマインド",
    birthday: "誕生日",
    review_request: "レビュー依頼",
    reactivation: "離脱客復活",
    broadcast: "一斉配信",
  };

  return (
    <AppLayout>
      <PageHeader eyebrow="— LINE Broadcast —" title="LINE一斉配信" description="Send to all your LINE friends in one tap" />

      <div className="max-w-3xl space-y-12">
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-4 h-4 text-gold" />
            <h2 className="display text-xl">新規配信</h2>
          </div>

          <div>
            <Label className="mb-3 block font-serif text-sm">配信対象</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {segments.map(s => (
                <button key={s.value} type="button" onClick={() => setSegment(s.value)}
                  className={`text-left p-3 border transition-all ${segment === s.value ? "border-gold bg-gold/5" : "border-border hover:border-gold/50"}`}>
                  <div className="font-serif text-sm">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</div>
                  <div className="eyebrow text-[9px] text-gold mt-1.5">{counts[s.value] ?? "—"} 名</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block font-serif text-sm">本文</Label>
            <Textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="例：{{name}}様&#10;&#10;今週末、特別キャンペーンのお知らせです🌸&#10;..."
              rows={8}
              className="rounded-none focus-visible:ring-0 focus-visible:border-gold" />
            <p className="text-[10px] text-muted-foreground mt-2">
              {`{{name}}`} はお客様のお名前に自動置換されます。 / {message.length} / 1000文字
            </p>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" disabled={sending || !message.trim() || (counts[segment] ?? 0) === 0}
                className="rounded-none px-12 py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow">
                {sending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
                配信する <span className="ml-2 opacity-60 text-[10px]">BROADCAST</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{counts[segment] ?? 0}名に配信します</AlertDialogTitle>
                <AlertDialogDescription>
                  この操作は取り消せません。LINE Messaging APIの月間無料枠（200通/月）にもご注意ください。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={broadcast}>送信する</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <section className="space-y-5 pt-8 border-t border-border">
          <div className="flex items-center gap-3">
            <History className="w-4 h-4 text-gold" />
            <h2 className="display text-xl">配信ログ（直近50件）</h2>
          </div>

          {loadingLogs ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
          ) : logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">まだ配信履歴がありません。</p>
          ) : (
            <div className="space-y-2">
              {logs.map(l => (
                <div key={l.id} className="border border-border p-4 bg-secondary/10">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`text-[10px] px-2 py-0.5 ${l.status === "sent" ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
                      {l.status === "sent" ? "送信成功" : "失敗"}
                    </span>
                    <span className="eyebrow text-[10px] text-gold">{jobTypeLabel[l.job_type] || l.job_type}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(l.created_at).toLocaleString("ja-JP")}
                    </span>
                  </div>
                  <p className="text-xs whitespace-pre-wrap text-foreground/80 line-clamp-3">{l.message}</p>
                  {l.error && <p className="text-[10px] text-destructive mt-2">⚠ {l.error}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
};

export default LineBroadcast;
