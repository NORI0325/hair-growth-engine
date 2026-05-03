import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarDays, ArrowLeft, XCircle, CheckCircle2, Coins, Gift } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BookingRow {
  id: string;
  booking_date: string;
  booking_time: string;
  menu: string;
  status: string;
  staff_name: string | null;
  total_price: number | null;
  total_duration_minutes: number | null;
  can_cancel: boolean;
  cancel_deadline_hours: number;
}

const statusLabel = (s: string) => {
  switch (s) {
    case "pending": return { label: "確認中", color: "text-amber-600 border-amber-600/40" };
    case "confirmed": return { label: "確定", color: "text-green-700 border-green-700/40" };
    case "completed": return { label: "ご来店済み", color: "text-muted-foreground border-border" };
    case "cancelled": return { label: "キャンセル", color: "text-muted-foreground border-border line-through" };
    case "no_show": return { label: "ご来店なし", color: "text-muted-foreground border-border" };
    default: return { label: s, color: "text-muted-foreground border-border" };
  }
};

const MyBookings = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [salonName, setSalonName] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [pointBalance, setPointBalance] = useState<number>(0);
  const [redemptionItems, setRedemptionItems] = useState<any[]>([]);
  const [redeeming, setRedeeming] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    const [verifyRes, bookingsRes, pointsRes] = await Promise.all([
      supabase.functions.invoke("verify-booking-token", { body: { token } }),
      supabase.rpc("get_customer_bookings" as any, { _token: token }),
      supabase.rpc("get_customer_point_summary" as any, { _token: token }),
    ]);
    if (verifyRes.data?.customer) {
      setCustomerName(verifyRes.data.customer.full_name);
      setSalonName(verifyRes.data.salon_name || "サロン");
    }
    setBookings((bookingsRes.data as any) || []);
    const ps: any = pointsRes.data;
    if (ps?.success) {
      setPointBalance(ps.balance || 0);
      setRedemptionItems(ps.redemption_items || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [token]);

  const redeem = async (itemId: string, name: string, cost: number) => {
    if (!confirm(`${cost.toLocaleString()}pt で「${name}」と交換しますか？\n次回ご来店時に適用されます。`)) return;
    setRedeeming(itemId);
    const { data } = await supabase.rpc("redeem_customer_points" as any, { _token: token, _item_id: itemId });
    setRedeeming(null);
    const r: any = data;
    if (!r?.success) {
      const msg = r?.error === "insufficient_points" ? "ポイントが不足しています"
        : r?.error === "out_of_stock" ? "在庫切れです" : "交換できませんでした";
      toast.error(msg);
      return;
    }
    toast.success("交換を申請しました。次回ご来店時に適用されます。");
    load();
  };

  const cancel = async (id: string) => {
    setCancelling(id);
    const { data, error } = await supabase.functions.invoke("cancel-booking", {
      body: { token, booking_id: id },
    });
    setCancelling(null);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || "キャンセルに失敗しました");
      return;
    }
    toast.success("ご予約をキャンセルしました");
    await load();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-10 animate-fade-up">
          <p className="eyebrow mb-3 text-gold">— Your Reservations —</p>
          <h1 className="display text-2xl mb-2">{customerName} 様</h1>
          <p className="text-xs text-muted-foreground font-serif">{salonName}</p>
          <div className="hairline w-16 mx-auto my-6" />
        </div>

        <Link to={`/book/${token}`} className="inline-flex items-center gap-2 text-xs eyebrow text-gold hover:opacity-70 mb-6">
          <ArrowLeft className="w-3 h-3" /> 新しいご予約はこちら
        </Link>

        {bookings.length === 0 ? (
          <div className="border border-border bg-secondary/30 p-10 text-center">
            <CalendarDays className="w-8 h-8 text-muted-foreground mx-auto mb-4 stroke-[1]" />
            <p className="text-sm text-muted-foreground font-serif">まだご予約はございません</p>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map(b => {
              const st = statusLabel(b.status);
              return (
                <div key={b.id} className="border border-border bg-card p-5 animate-fade-up">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="display text-lg leading-tight">
                        {new Date(b.booking_date).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}
                      </p>
                      <p className="font-serif text-sm text-muted-foreground mt-1">
                        {b.booking_time.slice(0, 5)}
                        {b.total_duration_minutes ? ` ・ 約${b.total_duration_minutes}分` : ""}
                      </p>
                    </div>
                    <span className={`text-[10px] px-2 py-1 border tracking-wider ${st.color}`}>{st.label}</span>
                  </div>

                  <div className="space-y-2 text-xs font-serif border-t border-border pt-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">メニュー</span>
                      <span className="text-right">{b.menu}</span>
                    </div>
                    {b.staff_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">担当</span>
                        <span>{b.staff_name}</span>
                      </div>
                    )}
                    {b.total_price ? (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">合計</span>
                        <span>¥{b.total_price.toLocaleString()}</span>
                      </div>
                    ) : null}
                  </div>

                  {b.can_cancel ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm"
                          className="w-full mt-4 rounded-none border-destructive/40 text-destructive text-xs tracking-luxury hover:bg-destructive/5">
                          <XCircle className="w-3.5 h-3.5 mr-2" /> このご予約をキャンセル
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>キャンセルしますか？</AlertDialogTitle>
                          <AlertDialogDescription>
                            {new Date(b.booking_date).toLocaleDateString("ja-JP")} {b.booking_time.slice(0, 5)}<br />
                            {b.menu}<br /><br />
                            この操作は取り消せません。サロンへ即時通知されます。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>戻る</AlertDialogCancel>
                          <AlertDialogAction onClick={() => cancel(b.id)} disabled={cancelling === b.id}
                            className="bg-destructive hover:bg-destructive/90">
                            {cancelling === b.id && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                            キャンセルする
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : ["pending", "confirmed"].includes(b.status) ? (
                    <p className="text-[10px] text-muted-foreground mt-4 text-center leading-relaxed">
                      ご予約{b.cancel_deadline_hours}時間前を過ぎたためオンラインでのキャンセルは承れません。<br />
                      お手数ですがサロンへ直接ご連絡ください。
                    </p>
                  ) : b.status === "completed" ? (
                    <p className="text-[10px] text-gold mt-4 text-center font-serif inline-flex items-center justify-center gap-1 w-full">
                      <CheckCircle2 className="w-3 h-3" /> ご来店ありがとうございました
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-center text-muted-foreground mt-10 tracking-wider">
          このページは {customerName} 様専用です
        </p>
      </div>
    </div>
  );
};

export default MyBookings;
