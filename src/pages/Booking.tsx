import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Scissors, Calendar, Clock, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const MENUS = ["カット", "カット＋カラー", "カット＋パーマ", "縮毛矯正", "ヘッドスパ", "その他"];
const TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];

const Booking = () => {
  const { token } = useParams();
  const navigate = useNavigate();
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
      if (!token) {
        toast.error("リンクが無効です");
        setLoading(false);
        return;
      }
      const { data } = await supabase.functions.invoke("verify-booking-token", {
        body: { token },
      });
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
    if (!date || !time || !menu) {
      toast.error("日付・時間・メニューを選んでください");
      return;
    }
    setBooking(true);
    const { data, error } = await supabase.functions.invoke("create-booking", {
      body: { token, date, time, menu, notes },
    });
    setBooking(false);
    if (error || !data?.success) {
      toast.error("予約に失敗しました。もう一度お試しください。");
      return;
    }
    setCompleted(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--gradient-soft)" }}>
        <Card className="max-w-md w-full p-8 text-center">
          <h2 className="text-xl font-bold mb-2">リンクが無効です</h2>
          <p className="text-muted-foreground text-sm">
            このリンクは期限切れか無効です。サロンへ直接お問い合わせください。
          </p>
        </Card>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--gradient-soft)" }}>
        <Card className="max-w-md w-full p-8 text-center shadow-elegant">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-2xl font-bold mb-2">ご予約ありがとうございます</h2>
          <p className="text-muted-foreground mb-6">
            {customer.full_name}様<br />
            {new Date(date).toLocaleDateString("ja-JP")} {time} のご予約を承りました。
          </p>
          <div className="bg-muted p-4 rounded-lg text-left text-sm space-y-2 mb-6">
            <div><span className="text-muted-foreground">日時:</span> {new Date(date).toLocaleDateString("ja-JP")} {time}</div>
            <div><span className="text-muted-foreground">メニュー:</span> {menu}</div>
            <div><span className="text-muted-foreground">サロン:</span> {salonName}</div>
          </div>
          <p className="text-xs text-muted-foreground">
            ご来店をお待ちしております。
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 py-8" style={{ background: "var(--gradient-soft)" }}>
      <div className="max-w-md mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: "var(--gradient-primary)" }}>
            <Scissors className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">{salonName}</h1>
        </div>

        {/* クーポン表示 */}
        <Card className="mb-6 border-primary/30 overflow-hidden shadow-elegant">
          <div style={{ background: "var(--gradient-primary)" }} className="p-6 text-primary-foreground text-center">
            <Sparkles className="w-6 h-6 mx-auto mb-2" />
            <div className="text-sm opacity-90">{customer.full_name}様への特別ご招待</div>
            <div className="text-2xl font-bold mt-1">お久しぶりクーポン</div>
            <div className="text-sm opacity-90 mt-2">予約完了画面でスタッフへご提示ください</div>
          </div>
        </Card>

        {/* 予約フォーム */}
        <Card className="shadow-soft">
          <CardContent className="pt-6 space-y-4">
            <h2 className="font-bold text-lg mb-2">ご希望の予約内容</h2>

            <div>
              <Label htmlFor="date" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />日付
              </Label>
              <Input id="date" type="date" min={minDate} value={date} onChange={e => setDate(e.target.value)} />
            </div>

            <div>
              <Label className="flex items-center gap-2">
                <Clock className="w-4 h-4" />時間
              </Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {TIMES.map(t => (
                  <Button key={t} variant={time === t ? "default" : "outline"} size="sm"
                    onClick={() => setTime(t)}>
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>メニュー</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {MENUS.map(m => (
                  <Button key={m} variant={menu === m ? "default" : "outline"} size="sm"
                    onClick={() => setMenu(m)}>
                    {m}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="notes">ご要望（任意）</Label>
              <Textarea id="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <Button onClick={handleBook} disabled={booking} className="w-full" size="lg"
              style={{ background: "var(--gradient-primary)" }}>
              {booking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              この内容で予約する
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground mt-6">
          このリンクは{customer.full_name}様専用です
        </p>
      </div>
    </div>
  );
};

export default Booking;
