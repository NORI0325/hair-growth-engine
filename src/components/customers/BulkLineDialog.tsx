import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onClose: () => void;
  customerIds: string[];
  customerNames: string[];
}

const BulkLineDialog = ({ open, onClose, customerIds, customerNames }: Props) => {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (message.trim().length < 2) { toast.error("メッセージを入力してください"); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("line-broadcast", {
      body: { message, customer_ids: customerIds },
    });
    setSending(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "送信に失敗しました");
      return;
    }
    const d = data as any;
    toast.success(`${d.sent}名へ送信しました（失敗 ${d.failed}名）`);
    setMessage("");
    onClose();
  };

  const preview = customerNames.slice(0, 5).join(" / ") + (customerNames.length > 5 ? ` 他${customerNames.length - 5}名` : "");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#06C755]" />
            LINE一斉送信
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="border border-border bg-secondary/30 p-3">
            <p className="eyebrow text-[10px] mb-1.5">— Recipients —</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-serif-en text-base text-foreground">{customerIds.length}</span> 名
              <span className="mx-2">·</span>
              {preview}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1.5">※ LINE未連携の方は自動的に除外されます</p>
          </div>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="例：いつもありがとうございます。今週ご来店の方限定で次回20%OFFクーポンをお渡ししています。{{name}} 様もぜひ。"
            className="rounded-none text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            <code className="bg-secondary px-1">{`{{name}}`}</code> で各顧客のお名前に自動置換されます
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="rounded-none">キャンセル</Button>
          <Button onClick={send} disabled={sending} className="rounded-none bg-[#06C755] hover:bg-[#06C755]/90">
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
            {customerIds.length}名へ送信
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkLineDialog;
