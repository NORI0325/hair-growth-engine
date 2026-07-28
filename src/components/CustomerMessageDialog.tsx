import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send, MessageCircle, Phone, Sparkles, Wand2, AlertTriangle, Ban } from "lucide-react";
import { toast } from "sonner";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Template {
  id: string;
  kind: string;
  title: string;
  body: string;
  sort_order: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  hasLine: boolean;
  bookingTime?: string; // "HH:MM"
  /** お客様が自動配信を停止している場合、手動連絡として送信前に確認ダイアログを出す */
  optOutAutomation?: boolean;
  /** LINE友だち解除済み（line_unfollowed_at が立っている）。送信不可表示にする */
  lineUnfollowed?: boolean;
}

export const CustomerMessageDialog = ({
  open, onClose, customerId, customerName, customerPhone, hasLine, bookingTime,
  optOutAutomation, lineUnfollowed,
}: Props) => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [minutes, setMinutes] = useState(15);
  const [newTime, setNewTime] = useState(bookingTime || "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmOptOutOpen, setConfirmOptOutOpen] = useState(false);

  // AI下書き機能
  const [aiContext, setAiContext] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<{ tone: string; label: string; body: string }[]>([]);
  const [aiPickedTone, setAiPickedTone] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tenantId) return;
    setLoading(true);
    setSelected(null);
    setBody("");
    setAiContext("");
    setAiSuggestions([]);
    setAiPickedTone(null);
    let q = supabase.from("customer_message_templates")
      .select("*").eq("active", true).order("sort_order");
    q = q.eq("owner_id", tenantId);
    if (locationId) q = q.eq("location_id", locationId);
    q.then(({ data }) => {
      setTemplates(data || []);
      setLoading(false);
    });
  }, [open, tenantId, locationId]);

  const generateAiDrafts = async () => {
    setAiLoading(true);
    setAiSuggestions([]);
    setAiPickedTone(null);
    const { data, error } = await supabase.functions.invoke("ai-reply-suggestions", {
      body: { customer_id: customerId, context: aiContext },
    });
    setAiLoading(false);
    if (error || (data as any)?.error) {
      const msg = (data as any)?.message || (data as any)?.error || error?.message || "AI下書きの生成に失敗しました";
      toast.error(msg);
      return;
    }
    const sug = (data as any)?.suggestions || [];
    setAiSuggestions(sug);
    if (sug.length === 0) toast.error("提案を生成できませんでした");
  };

  const pickAiSuggestion = (s: { tone: string; body: string }) => {
    setSelected(null);
    setBody(s.body);
    setAiPickedTone(s.tone);
  };

  // 差し込み変数を反映
  const renderedBody = useMemo(() => {
    return body
      .split("{customer_name}").join(customerName || "お客様")
      .split("{minutes}").join(String(minutes))
      .split("{new_time}").join(newTime || "—");
  }, [body, customerName, minutes, newTime]);

  const pickTemplate = (t: Template) => {
    setSelected(t);
    setBody(t.body);
    // デフォルトの新時刻提案：早上がり=15分前/相談=30分後
    if (bookingTime) {
      const [h, m] = bookingTime.split(":").map(Number);
      const total = h * 60 + m + (t.kind === "early" ? -15 : t.kind === "reschedule" ? 30 : 0);
      const nh = Math.floor(((total % 1440) + 1440) % 1440 / 60);
      const nm = ((total % 60) + 60) % 60;
      setNewTime(`${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`);
    }
  };

  const doSend = async () => {
    setConfirmOptOutOpen(false);
    if (renderedBody.length < 5) { toast.error("メッセージを入力してください"); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("send-customer-message", {
      body: { customer_id: customerId, message: renderedBody },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      const msg = (data as any)?.message || (data as any)?.error || error?.message || "送信に失敗しました";
      toast.error(msg);
      return;
    }
    toast.success("送信しました");
    onClose();
  };

  const send = () => {
    if (renderedBody.length < 5) { toast.error("メッセージを入力してください"); return; }
    if (optOutAutomation) { setConfirmOptOutOpen(true); return; }
    doSend();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-gold" />
            {customerName} 様へご連絡
          </DialogTitle>
        </DialogHeader>

        {lineUnfollowed ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full border border-destructive/40 mx-auto flex items-center justify-center">
              <Ban className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-sm text-foreground">
              このお客様はLINEの友だちを解除済みです。<br />
              LINE送信はできません。お電話・SMS等でご連絡くださいませ。
            </p>
            {customerPhone && (
              <a href={`tel:${customerPhone}`} className="inline-block">
                <Button className="rounded-none">
                  <Phone className="w-3.5 h-3.5 mr-2" />{customerPhone} に電話
                </Button>
              </a>
            )}
          </div>
        ) : !hasLine ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full border border-border mx-auto flex items-center justify-center">
              <Phone className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              このお客様はLINE未連携です。<br />
              お電話で直接ご連絡くださいませ。
            </p>
            {customerPhone && (
              <a href={`tel:${customerPhone}`} className="inline-block">
                <Button className="rounded-none">
                  <Phone className="w-3.5 h-3.5 mr-2" />{customerPhone} に電話
                </Button>
              </a>
            )}
          </div>
        ) : loading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" />
          </div>
        ) : (
          <div className="space-y-5">
            {optOutAutomation && (
              <div className="border border-warning/50 bg-warning/10 px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="text-[11px] text-foreground/80">
                  このお客様は<span className="font-serif text-warning">自動配信を停止</span>しています。<br />
                  販促配信ではなく、必要な手動連絡であることをご確認のうえ送信してください。
                </div>
              </div>
            )}
            {/* AI下書きアシスト */}
            <div className="border border-gold/30 bg-gradient-to-br from-secondary/20 to-transparent p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="eyebrow text-[10px] flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-gold" />
                  — AI Concierge Draft —
                </Label>
                <span className="text-[10px] text-muted-foreground">3案を瞬時に生成</span>
              </div>
              <Textarea
                value={aiContext}
                onChange={(e) => setAiContext(e.target.value)}
                rows={2}
                placeholder="伝えたい内容や状況を一言（例：本日少し遅れそう / 次回ご来店感謝 / 髪の調子確認 など）"
                className="rounded-none text-sm"
              />
              <Button
                type="button"
                onClick={generateAiDrafts}
                disabled={aiLoading}
                variant="outline"
                className="rounded-none w-full border-gold/50 hover:bg-gold/10"
              >
                {aiLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />生成中…</>
                ) : (
                  <><Wand2 className="w-3.5 h-3.5 mr-2 text-gold" />AIで返信案を作る</>
                )}
              </Button>

              {aiSuggestions.length > 0 && (
                <div className="space-y-2 pt-2">
                  {aiSuggestions.map((s) => (
                    <button
                      key={s.tone}
                      type="button"
                      onClick={() => pickAiSuggestion(s)}
                      className={`w-full text-left px-3 py-2.5 border transition-all ${
                        aiPickedTone === s.tone
                          ? "border-gold bg-secondary/40"
                          : "border-border hover:border-gold/40 bg-background/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-gold font-serif">{s.label}</span>
                      </div>
                      <div className="text-xs text-foreground/80 whitespace-pre-wrap line-clamp-3">{s.body}</div>
                    </button>
                  ))}
                  <p className="text-[10px] text-muted-foreground">
                    💡 案を選んでから下のプレビューで自由に編集できます。
                  </p>
                </div>
              )}
            </div>

            {/* テンプレート選択 */}
            <div>
              <Label className="eyebrow text-[10px] mb-2 block">— Tone Templates —</Label>
              <div className="space-y-2">
                {templates.map(t => (
                  <button key={t.id} type="button" onClick={() => pickTemplate(t)}
                    className={`w-full text-left px-4 py-3 border transition-all ${selected?.id === t.id ? "border-gold bg-secondary/30" : "border-border hover:border-gold/40"}`}>
                    <div className="font-serif text-sm">{t.title}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1 mt-1">{t.body.slice(0, 60)}…</div>
                  </button>
                ))}
                <button type="button" onClick={() => { setSelected(null); setBody(""); }}
                  className={`w-full text-left px-4 py-3 border transition-all ${!selected ? "border-gold bg-secondary/30" : "border-border hover:border-gold/40"}`}>
                  <div className="font-serif text-sm text-muted-foreground">— 自由文で送る —</div>
                </button>
              </div>
            </div>

            {/* 変数入力 */}
            {selected && (selected.body.includes("{minutes}") || selected.body.includes("{new_time}")) && (
              <div className="grid grid-cols-2 gap-3">
                {selected.body.includes("{minutes}") && (
                  <div>
                    <Label className="text-xs">何分ほど</Label>
                    <Input type="number" min={5} max={120} value={minutes}
                      onChange={e => setMinutes(parseInt(e.target.value) || 15)}
                      className="rounded-none mt-1" />
                  </div>
                )}
                {selected.body.includes("{new_time}") && (
                  <div>
                    <Label className="text-xs">提案する時刻</Label>
                    <Input type="time" value={newTime}
                      onChange={e => setNewTime(e.target.value)}
                      className="rounded-none mt-1" />
                  </div>
                )}
              </div>
            )}

            {/* プレビュー（編集可） */}
            <div>
              <Label className="text-xs flex justify-between">
                <span>プレビュー（編集可能）</span>
                <span className="text-muted-foreground">{renderedBody.length}/2000</span>
              </Label>
              <Textarea value={renderedBody} onChange={e => {
                // 編集すると変数置換は破棄して自由文化
                setBody(e.target.value);
              }} rows={9} className="rounded-none mt-1 font-serif text-sm" />
              <p className="text-[10px] text-muted-foreground mt-1">
                LINEで送信されます。送信前にトーンと内容をご確認ください。
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} className="rounded-none">キャンセル</Button>
              <Button onClick={send} disabled={sending} className="rounded-none">
                {sending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
                LINEで送信
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      <AlertDialog open={confirmOptOutOpen} onOpenChange={setConfirmOptOutOpen}>
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              自動配信停止中のお客様です
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                {customerName} 様は自動配信（販促・キャンペーン）を停止しています。
              </span>
              <span className="block">
                今回の送信が <span className="font-serif text-foreground">手動の必要連絡</span> である場合のみ続行してください。
                販促目的の場合は送信をお控えください。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={doSend} className="rounded-none">
              手動連絡として送信する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
