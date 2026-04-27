import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Megaphone, Send, Loader2, Users, Mail, MessageSquare } from "lucide-react";

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

const Campaigns = () => {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({
    title: "",
    email_subject: "",
    email_body: "",
    sms_body: "",
    send_email: true,
    send_sms: false,
    target_segment: "dormant" as "active" | "at_risk" | "dormant" | "all",
  });

  const load = async () => {
    const { data } = await supabase
      .from("campaigns")
      .select("id, title, email_subject, status, total_recipients, sent_at, send_email, send_sms, target_segment")
      .order("created_at", { ascending: false });
    if (data) setCampaigns(data as Campaign[]);
  };

  useEffect(() => { load(); }, []);

  const applyTemplate = (idx: number) => {
    const t = TEMPLATES[idx];
    setForm(f => ({
      ...f,
      title: t.name,
      email_subject: t.subject,
      email_body: t.body,
      sms_body: t.sms,
    }));
  };

  const handleSend = async () => {
    if (!user) return;
    if (!form.title || !form.email_subject || !form.email_body) {
      toast.error("タイトル・件名・本文を入力してください");
      return;
    }
    if (form.send_sms && !form.sms_body) {
      toast.error("SMS本文を入力してください");
      return;
    }

    setSending(true);
    const { data: campaign, error } = await supabase
      .from("campaigns")
      .insert({
        owner_id: user.id,
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

    if (error || !campaign) {
      toast.error("キャンペーン作成に失敗しました");
      setSending(false);
      return;
    }

    const { data: result, error: invokeError } = await supabase.functions.invoke("send-campaign", {
      body: { campaign_id: campaign.id },
    });

    setSending(false);
    if (invokeError) {
      toast.error("配信に失敗しました: " + invokeError.message);
      return;
    }

    toast.success(`配信を開始しました (${result?.recipients || 0}名)`);
    setOpen(false);
    setForm({
      title: "", email_subject: "", email_body: "", sms_body: "",
      send_email: true, send_sms: false, target_segment: "dormant",
    });
    load();
  };

  const statusBadge = (s: string) => {
    if (s === "sent") return <Badge variant="default">配信済</Badge>;
    if (s === "sending") return <Badge variant="secondary">配信中</Badge>;
    if (s === "failed") return <Badge variant="destructive">失敗</Badge>;
    return <Badge variant="outline">下書き</Badge>;
  };

  return (
    <AppLayout>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">キャンペーン</h1>
          <p className="text-muted-foreground">休眠客への配信で売上を呼び戻しましょう</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="lg" style={{ background: "var(--gradient-primary)" }}>
              <Megaphone className="w-4 h-4 mr-2" />新規キャンペーン
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>新規キャンペーン作成</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>テンプレートから選択</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {TEMPLATES.map((t, i) => (
                    <Button key={i} variant="outline" size="sm" onClick={() => applyTemplate(i)}>
                      {t.name}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="title">キャンペーンタイトル（管理用）</Label>
                <Input id="title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>

              <div>
                <Label htmlFor="segment">配信対象</Label>
                <Select value={form.target_segment} onValueChange={(v: any) => setForm({ ...form, target_segment: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dormant">休眠客（180日以上未来店）- おすすめ</SelectItem>
                    <SelectItem value="at_risk">離脱予備軍（90〜180日）</SelectItem>
                    <SelectItem value="active">アクティブ客</SelectItem>
                    <SelectItem value="all">全顧客</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <Label>メール配信</Label>
                </div>
                <Switch checked={form.send_email} onCheckedChange={v => setForm({ ...form, send_email: v })} />
              </div>

              {form.send_email && (
                <>
                  <div>
                    <Label htmlFor="subject">メール件名</Label>
                    <Input id="subject" value={form.email_subject} onChange={e => setForm({ ...form, email_subject: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="body">メール本文（{`{{name}}`} で氏名、{`{{booking_link}}`} で予約リンク）</Label>
                    <Textarea id="body" rows={8} value={form.email_body} onChange={e => setForm({ ...form, email_body: e.target.value })} />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  <Label>SMS配信（重要顧客への高反応率）</Label>
                </div>
                <Switch checked={form.send_sms} onCheckedChange={v => setForm({ ...form, send_sms: v })} />
              </div>

              {form.send_sms && (
                <div>
                  <Label htmlFor="sms">SMS本文（160字以内推奨）</Label>
                  <Textarea id="sms" rows={3} value={form.sms_body} onChange={e => setForm({ ...form, sms_body: e.target.value })} />
                </div>
              )}

              <Button onClick={handleSend} disabled={sending} className="w-full" size="lg">
                {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />配信中...</>
                  : <><Send className="w-4 h-4 mr-2" />今すぐ配信</>}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {campaigns.length === 0 ? (
        <Card className="p-12 text-center shadow-soft">
          <Megaphone className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-bold mb-2">まだキャンペーンがありません</h3>
          <p className="text-sm text-muted-foreground mb-6">
            休眠客に「お久しぶりクーポン」を送って、来店を促しましょう
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <Card key={c.id} className="shadow-soft">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold">{c.title}</h3>
                  {statusBadge(c.status)}
                </div>
                <p className="text-sm text-muted-foreground mb-3">{c.email_subject}</p>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{c.total_recipients}名</span>
                  {c.send_email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />メール</span>}
                  {c.send_sms && <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />SMS</span>}
                  {c.sent_at && <span className="text-muted-foreground">{new Date(c.sent_at).toLocaleString("ja-JP")}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
};

export default Campaigns;
