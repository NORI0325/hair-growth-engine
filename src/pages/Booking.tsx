import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const MENUS = ["カット", "カット＋カラー", "カット＋パーマ", "縮毛矯正", "ヘッドスパ", "その他"];
const TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];

const Booking = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [customer, setCustomer] = useState<any>(null);
  const [salonName, setSalonName] = useState("");

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [menu, setMenu] = useState("");
  const [notes, setNotes] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!token) { toast.error("リンクが無効です"); setLoading(false); return; }
      const { data } = await supabase.functions.invoke("verify-booking-token", { body: { token } });
      if (data?.customer) {
        setCustomer(data.customer);
        setSalonName(data.salon_name || "Salon Boost");
      } else {
        toast.error("リンクが無効です");
      }
      setLoading(false);
    };
    load();
  }, [token]);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  const handleBook = async () => {
    if (!date || !time || !menu) { toast.error("日付・時間・メニューをお選びください"); return; }
    setBooking(true);
    const { data, error } = await supabase.functions.invoke("create-booking", {
      body: { token, date, time, menu, notes },
    });
    setBooking(false);
    if (error || !data?.success) { toast.error("予約に失敗しました。もう一度お試しください。"); return; }
    setCompleted(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full text-center">
          <p className="eyebrow mb-4">— Notice —</p>
          <h2 className="display text-2xl mb-4">リンクが無効です</h2>
          <div className="hairline w-16 mx-auto mb-6" />
          <p className="text-sm text-muted-foreground leading-loose">
            このリンクは期限切れか無効です。<br />
            お手数ですがサロンへ直接お問い合わせください。
          </p>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background animate-fade-up">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full border border-gold/40 flex items-center justify-center mx-auto mb-8">
            <CheckCircle2 className="w-6 h-6 text-gold stroke-[1.5]" />
          </div>
          <p className="eyebrow mb-4 text-gold">— Reserved —</p>
          <h2 className="display text-3xl mb-3">ご予約を承りました</h2>
          <div className="hairline w-16 mx-auto my-6" />
          <p className="text-sm text-muted-foreground leading-loose mb-10">
            {customer.full_name} 様<br />
            {new Date(date).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}<br />
            {time} のご来店をお待ちしております。
          </p>
          <div className="text-left text-xs space-y-3 max-w-xs mx-auto pt-6 border-t border-border">
            <div className="flex justify-between"><span className="eyebrow">Date</span><span className="font-serif">{new Date(date).toLocaleDateString("ja-JP")}</span></div>
            <div className="flex justify-between"><span className="eyebrow">Time</span><span className="font-serif">{time}</span></div>
            <div className="flex justify-between"><span className="eyebrow">Menu</span><span className="font-serif">{menu}</span></div>
            <div className="flex justify-between"><span className="eyebrow">Salon</span><span className="font-serif">{salonName}</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-6">
      <div className="max-w-md mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-12 animate-fade-up">
          <div className="font-serif-en text-3xl tracking-luxury text-gold mb-2">SB</div>
          <h1 className="display text-xl">{salonName}</h1>
        </div>

        {/* クーポン */}
        <div className="border border-gold/40 mb-12 p-10 text-center bg-secondary/30 animate-fade-up animate-delay-100 relative">
          <div className="absolute top-0 left-0 w-full h-px bg-gold" />
          <div className="absolute bottom-0 left-0 w-full h-px bg-gold" />
          <p className="eyebrow mb-3 text-gold">— Special Invitation —</p>
          <p className="font-serif text-sm text-muted-foreground mb-4">{customer.full_name} 様へ</p>
          <h2 className="display text-2xl md:text-3xl mb-4">
            お久しぶりクーポン
          </h2>
          <div className="hairline w-12 mx-auto my-4 opacity-60" />
          <p className="text-xs text-muted-foreground leading-loose">
            ご来店の際、スタッフへこの画面をご提示ください。
          </p>
        </div>

        {/* フォーム */}
        <div className="space-y-8 animate-fade-up animate-delay-200">
          <div>
            <p className="eyebrow mb-3">No.01 — Date</p>
            <Input id="date" type="date" min={minDate} value={date} onChange={e => setDate(e.target.value)}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>

          <div>
            <p className="eyebrow mb-3">No.02 — Time</p>
            <div className="grid grid-cols-5 gap-px bg-border">
              {TIMES.map(t => (
                <button key={t} type="button" onClick={() => setTime(t)}
                  className={`py-3 text-sm font-serif transition-all ${time === t ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-3">No.03 — Menu</p>
            <div className="grid grid-cols-2 gap-px bg-border">
              {MENUS.map(m => (
                <button key={m} type="button" onClick={() => setMenu(m)}
                  className={`py-3 text-sm font-serif transition-all ${menu === m ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="notes" className="eyebrow mb-3 block">Notes (optional)</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold resize-none" />
          </div>

          <Button onClick={handleBook} disabled={booking} className="w-full rounded-none py-7 text-xs tracking-luxury bg-primary hover:bg-primary-glow shadow-elegant" size="lg">
            {booking ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
            CONFIRM RESERVATION
          </Button>
        </div>

        <p className="text-[10px] text-center text-muted-foreground mt-10 tracking-wider">
          このリンクは {customer.full_name} 様専用です
        </p>
      </div>
    </div>
  );
};

export default Booking;
