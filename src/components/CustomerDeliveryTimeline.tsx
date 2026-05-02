import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mail, MessageCircle, Loader2 } from "lucide-react";

interface Item {
  id: string;
  channel: "email" | "line";
  template_key: string | null;
  status: string;
  recipient: string | null;
  sent_at: string;
  error: string | null;
}

const LABEL: Record<string, string> = {
  reactivation: "復活クーポン", birthday: "お誕生日", thank_you: "サンクス",
  aftercare: "アフターケア", next_suggestion: "次回ご提案", review_request: "レビュー依頼",
  vip_upgrade: "VIPランクアップ", anniversary: "記念日", referral_thanks: "紹介感謝",
  holiday_notice: "休業のお知らせ", welcome: "ようこそ", reminder: "予約前リマインド",
  "booking-confirmation": "予約確定", "booking-reminder": "予約リマインド",
};

export default function CustomerDeliveryTimeline({ customerId }: { customerId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("customer_delivery_timeline" as any)
        .select("*")
        .eq("customer_id", customerId)
        .order("sent_at", { ascending: false })
        .limit(50);
      if (!error) setItems((data as any) || []);
      setLoading(false);
    })();
  }, [customerId]);

  if (loading) return <div className="py-6 text-center"><Loader2 className="w-4 h-4 mx-auto animate-spin text-muted-foreground"/></div>;
  if (items.length === 0) return <p className="text-xs text-muted-foreground py-4">配信履歴はまだありません</p>;

  return (
    <div className="border-t border-border">
      {items.map(it => (
        <div key={it.id} className="py-3 border-b border-border/60 flex items-start gap-3 text-xs">
          {it.channel === "email"
            ? <Mail className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0"/>
            : <MessageCircle className="w-3.5 h-3.5 mt-0.5 text-[#00B900] shrink-0"/>}
          <div className="flex-1 min-w-0">
            <div className="font-serif">
              {LABEL[it.template_key || ""] || it.template_key || "—"}
              {it.status !== "sent" && (
                <span className="ml-2 text-destructive text-[10px]">{it.status}</span>
              )}
            </div>
            <div className="text-muted-foreground mt-0.5">
              {new Date(it.sent_at).toLocaleString("ja-JP")} · {it.recipient || "—"}
            </div>
            {it.error && <div className="text-destructive text-[10px] mt-0.5 truncate">{it.error}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
