import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, X, Loader2, MessageSquare, Calendar, Copy, Sparkles, Clock } from "lucide-react";

interface ReservationRequest {
  id: string;
  customer_id: string | null;
  display_name: string | null;
  raw_message: string;
  ai_confidence: number;
  desired_date_candidates: any[];
  desired_menu: string | null;
  desired_staff_name: string | null;
  needs_clarification_fields: string[];
  status: string;
  outside_hours_notified: boolean;
  staff_memo: string | null;
  created_at: string;
  salonboard_transfer_text: string | null;
  customers?: { full_name: string; phone: string | null } | null;
}

const STATUS_COLUMNS = [
  { key: "awaiting_approval", label: "未承認", tone: "bg-amber-500/10 text-amber-800 border-amber-300" },
  { key: "pending_clarification", label: "要確認", tone: "bg-blue-500/10 text-blue-800 border-blue-300" },
  { key: "completed", label: "確定済", tone: "bg-emerald-500/10 text-emerald-800 border-emerald-300" },
  { key: "rejected", label: "却下", tone: "bg-muted text-muted-foreground border-border" },
] as const;

function jpDate(ymd?: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || "";
  const [, m, d] = ymd.split("-");
  const date = new Date(`${ymd}T00:00:00+09:00`);
  const w = ["日","月","火","水","木","金","土"][date.getDay()];
  return `${Number(m)}/${Number(d)}(${w})`;
}

export default function Reservations() {
  const { user } = useAuth();
  const [items, setItems] = useState<ReservationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "approve" | "propose" | "reject"; req: ReservationRequest } | null>(null);

  // フォーム状態
  const [confirmedDate, setConfirmedDate] = useState("");
  const [confirmedTime, setConfirmedTime] = useState("");
  const [confirmedMenu, setConfirmedMenu] = useState("");
  const [extraMessage, setExtraMessage] = useState("");
  const [proposalMessage, setProposalMessage] = useState("");
  const [rejectMessage, setRejectMessage] = useState("");

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("reservation_requests")
      .select("*, customers:customer_id(full_name, phone)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setItems((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const openApprove = (req: ReservationRequest) => {
    const firstCand = req.desired_date_candidates?.[0];
    setConfirmedDate(firstCand?.date || "");
    setConfirmedTime(firstCand?.time_range && /^\d{1,2}:\d{2}$/.test(firstCand.time_range) ? firstCand.time_range : "");
    setConfirmedMenu(req.desired_menu || "");
    setExtraMessage("");
    setDialog({ mode: "approve", req });
  };
  const openPropose = (req: ReservationRequest) => {
    setProposalMessage(`お問い合わせありがとうございます。\nご希望の日時はあいにく満席でしたが、以下のお時間はいかがでしょうか？\n\n・◯月◯日(◯) ◯◯:◯◯`);
    setDialog({ mode: "propose", req });
  };
  const openReject = (req: ReservationRequest) => {
    setRejectMessage("");
    setDialog({ mode: "reject", req });
  };

  const submit = async () => {
    if (!dialog) return;
    const { mode, req } = dialog;
    setBusy(req.id);
    const { data: { session } } = await supabase.auth.getSession();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reservation-approve`;
    const body: any = { request_id: req.id, action: mode };
    if (mode === "approve") {
      if (!confirmedDate || !confirmedTime) {
        toast.error("日付と時刻は必須です"); setBusy(null); return;
      }
      body.confirmed_date = confirmedDate;
      body.confirmed_time = confirmedTime;
      body.confirmed_menu = confirmedMenu;
      body.extra_message = extraMessage || undefined;
    } else if (mode === "propose") {
      body.proposal_message = proposalMessage;
    } else {
      body.reject_message = rejectMessage || undefined;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      toast.success(mode === "approve" ? "確定しました" : mode === "propose" ? "提案を送信しました" : "却下しました");
      if (mode === "approve" && json.salonboard_transfer_text) {
        try { await navigator.clipboard.writeText(json.salonboard_transfer_text); toast.success("サロンボード転記用テキストをコピーしました"); } catch {}
      }
      setDialog(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "エラー");
    } finally {
      setBusy(null);
    }
  };

  const copySalonboard = async (req: ReservationRequest) => {
    if (req.salonboard_transfer_text) {
      try { await navigator.clipboard.writeText(req.salonboard_transfer_text); toast.success("コピーしました"); } catch { toast.error("コピーに失敗しました"); }
    }
  };

  const grouped = STATUS_COLUMNS.map(col => ({
    ...col,
    items: items.filter(i => i.status === col.key),
  }));

  return (
    <AppLayout>
      <PageHeader
        eyebrow="LINE 24時間予約"
        title="予約仮受付"
        description="LINEから届いた予約希望を、スタッフ承認のうえサロンボードへ転記します。"
      />

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>まだ仮予約はありません。</p>
          <p className="text-sm mt-2">LINE公式アカウントに予約希望が届くとここに表示されます。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {grouped.map(col => (
            <div key={col.key} className="space-y-3">
              <div className={`px-3 py-2 border ${col.tone} text-sm font-semibold flex items-center justify-between`}>
                <span>{col.label}</span>
                <Badge variant="outline" className="rounded-none">{col.items.length}</Badge>
              </div>
              <div className="space-y-3">
                {col.items.map(req => (
                  <div key={req.id} className="border border-border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm">{req.customers?.full_name || req.display_name || "(未連携)"}</div>
                      <Badge variant="outline" className="rounded-none text-[10px] flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />{req.ai_confidence}
                      </Badge>
                    </div>
                    {req.outside_hours_notified && (
                      <Badge variant="outline" className="rounded-none text-[10px] bg-amber-50 text-amber-800 border-amber-300 flex items-center gap-1 w-fit">
                        <Clock className="h-3 w-3" />営業時間外受付
                      </Badge>
                    )}
                    <div className="text-xs space-y-1">
                      {req.desired_date_candidates?.length > 0 && (
                        <div>📅 {req.desired_date_candidates.slice(0,3).map((c: any) => `${jpDate(c.date)}${c.time_range ? `(${c.time_range})` : ""}`).join(" / ")}</div>
                      )}
                      {req.desired_menu && <div>💇 {req.desired_menu}</div>}
                      {req.desired_staff_name && <div>👤 {req.desired_staff_name}様</div>}
                      {req.needs_clarification_fields?.length > 0 && (
                        <div className="text-amber-700">⚠ 不足: {req.needs_clarification_fields.join(", ")}</div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted/40 p-2 border border-border whitespace-pre-wrap">
                      {req.raw_message.slice(0, 200)}{req.raw_message.length > 200 ? "…" : ""}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(req.created_at).toLocaleString("ja-JP")}
                    </div>
                    {(req.status === "awaiting_approval" || req.status === "pending_clarification") && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button size="sm" variant="default" className="h-7 text-xs flex-1 rounded-none" onClick={() => openApprove(req)} disabled={busy === req.id}>
                          <Check className="h-3 w-3 mr-1" />確定
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-none" onClick={() => openPropose(req)} disabled={busy === req.id}>
                          <Calendar className="h-3 w-3 mr-1" />調整
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-none" onClick={() => openReject(req)} disabled={busy === req.id}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {req.status === "completed" && req.salonboard_transfer_text && (
                      <Button size="sm" variant="outline" className="h-7 text-xs w-full rounded-none" onClick={() => copySalonboard(req)}>
                        <Copy className="h-3 w-3 mr-1" />サロンボード転記用コピー
                      </Button>
                    )}
                  </div>
                ))}
                {col.items.length === 0 && (
                  <div className="text-xs text-center text-muted-foreground py-6">なし</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "approve" && "予約を確定"}
              {dialog?.mode === "propose" && "別日時を提案"}
              {dialog?.mode === "reject" && "却下"}
            </DialogTitle>
          </DialogHeader>
          {dialog?.mode === "approve" && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground border border-border p-2 bg-muted/40">
                <div className="font-semibold">{dialog.req.customers?.full_name || dialog.req.display_name}</div>
                <div className="whitespace-pre-wrap text-xs mt-1">{dialog.req.raw_message}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>日付</Label><Input type="date" value={confirmedDate} onChange={e => setConfirmedDate(e.target.value)} /></div>
                <div><Label>時刻</Label><Input type="time" value={confirmedTime} onChange={e => setConfirmedTime(e.target.value)} /></div>
              </div>
              <div><Label>メニュー</Label><Input value={confirmedMenu} onChange={e => setConfirmedMenu(e.target.value)} /></div>
              <div><Label>追記メッセージ（任意）</Label><Textarea rows={3} value={extraMessage} onChange={e => setExtraMessage(e.target.value)} placeholder="例：お時間に余裕を持ってお越しください" /></div>
            </div>
          )}
          {dialog?.mode === "propose" && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground border border-border p-2 bg-muted/40">{dialog.req.customers?.full_name || dialog.req.display_name}様への提案文を入力してください</div>
              <Textarea rows={6} value={proposalMessage} onChange={e => setProposalMessage(e.target.value)} />
            </div>
          )}
          {dialog?.mode === "reject" && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">空欄の場合は標準の謝罪文が送信されます。</div>
              <Textarea rows={5} value={rejectMessage} onChange={e => setRejectMessage(e.target.value)} placeholder="（任意）お客様への返信文" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setDialog(null)}>キャンセル</Button>
            <Button onClick={submit} disabled={!!busy} className="rounded-none">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "送信"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
