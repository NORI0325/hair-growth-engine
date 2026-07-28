import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Send, Loader2, Mail, MessageSquare } from "lucide-react";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";

interface Campaign {
  id: string;
  title: string;
  email_subject: string;
  status: string;
  total_recipients: number;
  sent_at: string | null;
  send_email: boolean;
  send_sms: boolean;
  target_segment: string | null;
  // 集計
  clicks?: number;
  bookings_count?: number;
  revenue?: number;
}

const TEMPLATES = [
  {
    name: "お久しぶりです（休眠客掘り起こし）",
    subject: "お久しぶりです、特別なご案内です",
    body: `{{name}}様

ご無沙汰しております。お変わりありませんか？

最後のご来店から少しお時間が空いてしまいましたので、
お久しぶりの{{name}}様だけに特別なクーポンをご用意しました。

▼ ワンタップで予約はこちら
{{booking_link}}

ぜひお気軽にご利用くださいませ。`,
    sms: "{{name}}様、お久しぶりです。特別クーポンをご用意しました→{{booking_link}}",
  },
  {
    name: "ありがとうクーポン",
    subject: "{{name}}様への感謝のクーポン",
    body: `{{name}}様

いつもご利用いただきありがとうございます。
日頃の感謝を込めて、特別クーポンをお贈りします。

▼ ワンタップで予約
{{booking_link}}`,
    sms: "{{name}}様、感謝のクーポンをお贈りします→{{booking_link}}",
  },
];

const statusInfo = (s: string) => {
  if (s === "sent") return { label: "配信済", color: "text-success" };
  if (s === "sending") return { label: "配信中", color: "text-warning" };
  if (s === "failed") return { label: "失敗", color: "text-destructive" };
  return { label: "下書き", color: "text-muted-foreground" };
};

const Campaigns = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({
    title: "", email_subject: "", email_body: "", sms_body: "",
    send_email: true, send_sms: false,
    target_segment: "dormant" as "active" | "at_risk" | "dormant" | "all",
  });

  const load = async () => {
    if (!tenantId || !locationId) return;
    const { data } = await supabase
      .from("campaigns")
      .select("id, title, email_subject, status, total_recipients, sent_at, send_email, send_sms, target_segment")
      .eq("owner_id", tenantId)
      .eq("location_id", locationId)
      .order("created_at", { ascending: false });
    if (!data) return;

    const ids = data.map((c: any) => c.id);
    if (ids.length === 0) { setCampaigns([]); return; }

    // クリック数を campaign_sends から
    const { data: sends } = await supabase
      .from("campaign_sends")
      .select("campaign_id, clicked_at, booked_at")
      .in("campaign_id", ids);

    // 配信経由の予約と売上を bookings から
    const { data: bks } = await supabase
      .from("bookings")
      .select("campaign_id, revenue, status")
      .in("campaign_id", ids);

    const enriched = data.map((c: any) => {
      const s = (sends || []).filter(x => x.campaign_id === c.id);
      const b = (bks || []).filter(x => x.campaign_id === c.id);
      return {
        ...c,
        clicks: s.filter(x => x.clicked_at).length,
        bookings_count: b.length,
        revenue: b.reduce((sum: number, x: any) => sum + (x.revenue || 0), 0),
      };
    });

    setCampaigns(enriched as Campaign[]);
  };

  useEffect(() => { load(); }, [tenantId, locationId]);

  const applyTemplate = (idx: number) => {
    const t = TEMPLATES[idx];
    setForm(f => ({ ...f, title: t.name, email_subject: t.subject, email_body: t.body, sms_body: t.sms }));
  };

  const handleSend = async () => {
    if (!user || !tenantId) return;
    if (!locationId) { toast.error("店舗が選択されていません"); return; }
    if (!form.title || !form.email_subject || !form.email_body) { toast.error("タイトル・件名・本文を入力してください"); return; }
    if (form.send_sms && !form.sms_body) { toast.error("SMS本文を入力してください"); return; }

    setSending(true);
    const { data: campaign, error } = await supabase
      .from("campaigns")
      .insert({
        owner_id: tenantId,
        location_id: locationId,
        title: form.title,
        email_subject: form.email_subject,
        email_body: form.email_body,
        sms_body: form.sms_body || null,
        send_email: form.send_email,
        send_sms: form.send_sms,
        target_segment: form.target_segment === "all" ? null : form.target_segment,
        status: "draft",
      })
      .select()
      .single();

    if (error || !campaign) { toast.error("キャンペーン作成に失敗しました"); setSending(false); return; }

    const { data: result, error: invokeError } = await supabase.functions.invoke("send-campaign", {
      body: { campaign_id: campaign.id },
    });

    setSending(false);
    if (invokeError) { toast.error("配信に失敗しました: " + invokeError.message); return; }

    toast.success(`配信を開始しました (${result?.recipients || 0}名)`);
    setOpen(false);
    setForm({ title: "", email_subject: "", email_body: "", sms_body: "", send_email: true, send_sms: false, target_segment: "dormant" });
    load();
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.04 — Outreach"
        title="配信"
        description="眠っているお客様の心に、静かに届く言葉を。"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="rounded-none px-8 py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow">
                + 新規作成 <span className="ml-2 opacity-60 text-[10px]">COMPOSE</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-none">
              <DialogHeader>
                <p className="eyebrow mb-2">— New Outreach —</p>
                <DialogTitle className="display text-2xl">新規キャンペーン</DialogTitle>
              </DialogHeader>
              <div className="hairline my-4" />
              <div className="space-y-6">
                <div>
                  <Label className="mb-3 block font-serif text-sm">テンプレート <span className="eyebrow text-[9px] text-muted-foreground ml-1">Templates</span></Label>
                  <div className="grid grid-cols-2 gap-2">
                    {TEMPLATES.map((t, i) => (
                      <Button key={i} variant="outline" size="sm" onClick={() => applyTemplate(i)}
                        className="rounded-none text-xs h-auto py-3 font-serif text-left justify-start whitespace-normal">
                        {t.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="title" className="mb-2 block font-serif text-sm">配信タイトル <span className="eyebrow text-[9px] text-muted-foreground ml-1">Title — 管理用</span></Label>
                  <Input id="title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                    className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                </div>

                <div>
                  <Label className="mb-2 block font-serif text-sm">配信対象 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Segment</span></Label>
                  <Select value={form.target_segment} onValueChange={(v: any) => setForm({ ...form, target_segment: v })}>
                    <SelectTrigger className="rounded-none border-x-0 border-t-0 focus:ring-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dormant">休眠客（180日以上）— 推奨</SelectItem>
                      <SelectItem value="at_risk">離脱予備軍（90〜180日）</SelectItem>
                      <SelectItem value="active">アクティブ客</SelectItem>
                      <SelectItem value="all">全顧客</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-3 border-y border-border">
                  <div className="flex items-center gap-3">
                    <Mail className="w-3.5 h-3.5 stroke-[1.5]" />
                    <Label className="font-serif">メール配信</Label>
                  </div>
                  <Switch checked={form.send_email} onCheckedChange={v => setForm({ ...form, send_email: v })} />
                </div>

                {form.send_email && (
                  <>
                    <div>
                      <Label htmlFor="subject" className="mb-2 block font-serif text-sm">件名 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Subject</span></Label>
                      <Input id="subject" value={form.email_subject} onChange={e => setForm({ ...form, email_subject: e.target.value })}
                        className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                    </div>
                    <div>
                      <Label htmlFor="body" className="mb-2 block font-serif text-sm">本文 <span className="eyebrow text-[9px] text-muted-foreground ml-1">差込タグ：{`{{name}}`} {`{{booking_link}}`}</span></Label>
                      <Textarea id="body" rows={8} value={form.email_body} onChange={e => setForm({ ...form, email_body: e.target.value })}
                        className="rounded-none focus-visible:ring-0 focus-visible:border-gold font-serif" />
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between py-3 border-y border-border">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="w-3.5 h-3.5 stroke-[1.5]" />
                    <Label className="font-serif">SMS配信</Label>
                  </div>
                  <Switch checked={form.send_sms} onCheckedChange={v => setForm({ ...form, send_sms: v })} />
                </div>

                {form.send_sms && (
                  <div>
                    <Label htmlFor="sms" className="mb-2 block font-serif text-sm">SMS本文 <span className="eyebrow text-[9px] text-muted-foreground ml-1">160文字以内推奨</span></Label>
                    <Textarea id="sms" rows={3} value={form.sms_body} onChange={e => setForm({ ...form, sms_body: e.target.value })}
                      className="rounded-none focus-visible:ring-0 focus-visible:border-gold font-serif" />
                  </div>
                )}

                <Button onClick={handleSend} disabled={sending} className="w-full rounded-none py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow" size="lg">
                  {sending ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />配信中...</>
                    : <><Send className="w-3.5 h-3.5 mr-2 stroke-[1.5]" />今すぐ配信する <span className="ml-2 opacity-60 text-[10px]">SEND</span></>}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {campaigns.length === 0 ? (
        <div className="py-24 text-center">
          <p className="eyebrow mb-3">— Awaiting First Outreach —</p>
          <h3 className="display text-2xl mb-3">まだ配信がありません</h3>
          <p className="text-sm text-muted-foreground">休眠客に「お久しぶりクーポン」を送って、来店を促しましょう</p>
        </div>
      ) : (
        <div className="border-t border-border">
          <div className="grid grid-cols-12 gap-4 py-4 border-b border-border text-[11px] font-serif text-muted-foreground">
            <div className="col-span-4">配信名</div>
            <div className="col-span-1 text-right">配信数</div>
            <div className="col-span-1 text-right">クリック</div>
            <div className="col-span-1 text-right">予約</div>
            <div className="col-span-2 text-right">売上</div>
            <div className="col-span-1 text-right">CVR</div>
            <div className="col-span-2 text-right">状態</div>
          </div>
          {campaigns.map(c => {
            const status = statusInfo(c.status);
            const cvr = c.total_recipients > 0 && c.bookings_count != null
              ? (c.bookings_count / c.total_recipients) * 100 : 0;
            return (
              <div key={c.id} className="grid grid-cols-12 gap-4 py-6 border-b border-border/60 hover:bg-secondary/30 transition-colors items-center">
                <div className="col-span-4">
                  <div className="font-serif text-sm mb-1">{c.title}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    {c.send_email && <Mail className="w-3 h-3 stroke-[1.5]" />}
                    {c.send_sms && <MessageSquare className="w-3 h-3 stroke-[1.5]" />}
                    {c.sent_at && <span className="font-serif-en">{new Date(c.sent_at).toLocaleDateString("ja-JP")}</span>}
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="font-serif-en text-lg">{c.total_recipients}</div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="font-serif-en text-lg text-muted-foreground">{c.clicks ?? 0}</div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="font-serif-en text-lg text-gold">{c.bookings_count ?? 0}</div>
                </div>
                <div className="col-span-2 text-right">
                  <div className="font-serif-en text-lg">¥{(c.revenue ?? 0).toLocaleString()}</div>
                </div>
                <div className="col-span-1 text-right">
                  <div className={`font-serif-en text-sm ${cvr >= 5 ? "text-success" : "text-muted-foreground"}`}>
                    {cvr.toFixed(1)}%
                  </div>
                </div>
                <div className="col-span-2 text-right">
                  <span className={`inline-flex items-center gap-2 text-[11px] font-serif ${status.color}`}>
                    <span className="w-1 h-1 rounded-full bg-current" />
                    {status.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
};

export default Campaigns;
