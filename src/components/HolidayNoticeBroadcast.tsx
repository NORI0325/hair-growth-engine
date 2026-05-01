import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarOff, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const HolidayNoticeBroadcast = () => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sending, setSending] = useState(false);

  const formatDate = (s: string): string => {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const wk = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${wk})`;
  };

  const broadcast = async () => {
    if (!title.trim()) {
      toast.error("お知らせのタイトルを入力してください");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("create_holiday_notice_jobs", {
        _notice_title: title.trim(),
        _notice_body: body.trim(),
        _start_date: startDate ? formatDate(startDate) : null,
        _end_date: endDate ? formatDate(endDate) : null,
      });
      if (error) throw error;
      const result = data as { success: boolean; queued?: number; error?: string };
      if (!result.success) throw new Error(result.error || "failed");
      toast.success(`${result.queued ?? 0}名の顧客への配信をキューに登録しました`);
      setTitle(""); setBody(""); setStartDate(""); setEndDate("");
    } catch (e) {
      toast.error(`一斉配信に失敗しました: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="space-y-5 pt-8 border-t border-border">
      <div>
        <p className="eyebrow mb-2 text-gold">— Holiday Notice —</p>
        <h3 className="display text-lg flex items-center gap-2">
          <CalendarOff className="w-4 h-4 text-gold" /> 休業・営業変更のお知らせ 一斉配信
        </h3>
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          連絡可能な全顧客（LINE/メール/SMSのいずれか登録済み）に休業案内を一斉送信します。
          配信は LINE → メール → SMS の優先順、JST 9〜21時の配信窓内で順次送信されます。
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-[11px] tracking-luxury">お知らせタイトル</Label>
          <Input
            placeholder="例：ゴールデンウィーク休業のお知らせ"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-none border-x-0 border-t-0 px-0 bg-transparent" />
        </div>

        <div>
          <Label className="text-[11px] tracking-luxury">本文</Label>
          <Textarea
            placeholder="例：誠に勝手ながら下記の期間、休業させていただきます。ご不便をおかけしますが、何卒よろしくお願いいたします。"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="rounded-none" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-[11px] tracking-luxury">開始日（任意）</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="rounded-none border-x-0 border-t-0 px-0 bg-transparent" />
          </div>
          <div>
            <Label className="text-[11px] tracking-luxury">終了日（任意）</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="rounded-none border-x-0 border-t-0 px-0 bg-transparent" />
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" disabled={sending || !title.trim()}
              className="rounded-none px-8 py-5 text-xs tracking-luxury bg-primary hover:bg-primary-glow">
              {sending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
              全顧客に一斉配信する <span className="ml-2 opacity-60 text-[10px]">BROADCAST</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>休業のお知らせを一斉配信しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                連絡可能な全顧客にお知らせが配信されます（LINE→メール→SMSの優先順）。<br />
                配信後の取り消しはできません。内容を再度ご確認ください。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction onClick={broadcast}>配信する</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
};

export default HolidayNoticeBroadcast;
