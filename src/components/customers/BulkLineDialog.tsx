import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, MessageCircle, Mail, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Customer {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  line_user_id?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
}

const BulkLineDialog = ({ open, onClose, customers }: Props) => {
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("サロンからのお知らせ");
  const [sending, setSending] = useState(false);
  const [useLine, setUseLine] = useState(true);
  const [useSms, setUseSms] = useState(false);
  const [useEmail, setUseEmail] = useState(false);
  const [skipRecent, setSkipRecent] = useState(true);
  const [skipDays, setSkipDays] = useState(7);

  const reach = useMemo(() => ({
    line: customers.filter((c) => /^U[0-9a-f]{32}$/i.test(c.line_user_id || "")).length,
    sms: customers.filter((c) => !!c.phone).length,
    email: customers.filter((c) => !!c.email).length,
  }), [customers]);

  const send = async () => {
    if (message.trim().length < 2) { toast.error("メッセージを入力してください"); return; }
    if (!useLine && !useSms && !useEmail) { toast.error("送信チャネルを選択してください"); return; }
    setSending(true);
    const channels: string[] = [];
    if (useLine) channels.push("line");
    if (useSms) channels.push("sms");
    if (useEmail) channels.push("email");
    const { data, error } = await supabase.functions.invoke("bulk-broadcast", {
      body: { message, subject, channels, customer_ids: customers.map((c) => c.id), skip_recent_days: skipRecent ? skipDays : 0 },
    });
    setSending(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "送信に失敗しました");
      return;
    }
    const d = data as any;
    const parts: string[] = [];
    if (useLine) parts.push(`LINE ${d.line.sent}/${d.line.sent + d.line.failed + d.line.skipped}`);
    if (useSms) parts.push(`SMS ${d.sms.sent}/${d.sms.sent + d.sms.failed + d.sms.skipped}`);
    if (useEmail) parts.push(`メール ${d.email.sent}/${d.email.sent + d.email.failed + d.email.skipped}`);
    toast.success(`送信完了: ${parts.join(" · ")}`);
    setMessage("");
    onClose();
  };

  const preview = customers.slice(0, 5).map((c) => c.full_name).join(" / ")
    + (customers.length > 5 ? ` 他${customers.length - 5}名` : "");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Send className="w-4 h-4 text-gold" />
            一斉送信
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="border border-border bg-secondary/30 p-3">
            <p className="eyebrow text-[10px] mb-1.5">— Recipients —</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-serif-en text-base text-foreground">{customers.length}</span> 名
              <span className="mx-2">·</span>{preview}
            </p>
          </div>

          <div className="space-y-2">
            <p className="eyebrow text-[10px]">— 送信チャネル —</p>
            <label className="flex items-center justify-between border border-border p-2.5 cursor-pointer hover:bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={useLine} onCheckedChange={(v) => setUseLine(!!v)} />
                <MessageCircle className="w-4 h-4 text-[#06C755]" />
                <span className="text-sm">LINE</span>
              </div>
              <span className="text-[10px] text-muted-foreground">配信可能 {reach.line}名</span>
            </label>
            <label className="flex items-center justify-between border border-border p-2.5 cursor-pointer hover:bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={useSms} onCheckedChange={(v) => setUseSms(!!v)} />
                <Smartphone className="w-4 h-4 text-blue-600" />
                <span className="text-sm">SMS</span>
              </div>
              <span className="text-[10px] text-muted-foreground">配信可能 {reach.sms}名</span>
            </label>
            <label className="flex items-center justify-between border border-border p-2.5 cursor-pointer hover:bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={useEmail} onCheckedChange={(v) => setUseEmail(!!v)} />
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">メール</span>
              </div>
              <span className="text-[10px] text-muted-foreground">配信可能 {reach.email}名</span>
            </label>
          </div>

          {useEmail && (
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="メール件名"
              className="rounded-none text-sm"
            />
          )}

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="例：いつもありがとうございます。{{name}} 様、今週ご来店の方限定で次回20%OFFクーポンをお渡ししています。"
            className="rounded-none text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            <code className="bg-secondary px-1">{`{{name}}`}</code> でお名前に自動置換されます ／ 連絡先未登録の方は自動的にスキップされます
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="rounded-none">キャンセル</Button>
          <Button onClick={send} disabled={sending} className="rounded-none bg-gold hover:bg-gold/90 text-foreground">
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
            {customers.length}名へ送信
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkLineDialog;
