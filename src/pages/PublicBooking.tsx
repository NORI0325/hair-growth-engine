import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const TIMES = ["10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"];

const schema = z.object({
  full_name: z.string().trim().min(1, "お名前を入力してください").max(100),
  phone: z.string().trim().min(8, "正しい電話番号を入力してください").max(20),
  email: z.string().trim().email("正しいメールアドレス").max(255).optional().or(z.literal("")),
  date: z.string().min(1, "日付を選択してください"),
  time: z.string().min(1, "時間を選択してください"),
  menu: z.string().min(1, "メニューを選択してください"),
  notes: z.string().max(500).optional(),
});

const PublicBooking = () => {
  const { slug } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [salon, setSalon] = useState<{ name: string; menus: string[] } | null>(null);
  const [completed, setCompleted] = useState(false);

  const [form, setForm] = useState({ full_name: "", phone: "", email: "", date: "", time: "", menu: "", notes: "" });

  useEffect(() => {
    const load = async () => {
      if (!slug) { setLoading(false); return; }
      const { data } = await supabase
        .from("profiles")
        .select("salon_name, public_menus")
        .eq("public_slug", slug)
        .maybeSingle();
      if (data) setSalon({ name: data.salon_name || "Salon", menus: data.public_menus || [] });
      setLoading(false);
    };
    load();
  }, [slug]);

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  const handleSubmit = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("public_create_booking", {
      _salon_slug: slug!,
      _full_name: parsed.data.full_name,
      _phone: parsed.data.phone,
      _email: parsed.data.email || "",
      _booking_date: parsed.data.date,
      _booking_time: parsed.data.time,
      _menu: parsed.data.menu,
      _notes: parsed.data.notes || "",
    });
    setSubmitting(false);
    if (error || !(data as any)?.success) {
      toast.error("ご予約に失敗しました。お手数ですが再度お試しください。");
      return;
    }
    setCompleted(true);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 animate-spin text-gold" />
    </div>
  );

  if (!salon) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full text-center">
        <p className="eyebrow mb-4">— Notice —</p>
        <h2 className="display text-2xl mb-4">サロンが見つかりません</h2>
        <p className="text-sm text-muted-foreground">URLをご確認ください。</p>
      </div>
    </div>
  );

  if (completed) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background animate-fade-up">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full border border-gold/40 flex items-center justify-center mx-auto mb-8">
          <CheckCircle2 className="w-6 h-6 text-gold stroke-[1.5]" />
        </div>
        <p className="eyebrow mb-4 text-gold">— Reserved —</p>
        <h2 className="display text-3xl mb-3">ご予約を承りました</h2>
        <div className="hairline w-16 mx-auto my-6" />
        <p className="text-sm text-muted-foreground leading-loose">
          {form.full_name} 様<br />
          {new Date(form.date).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}<br />
          {form.time} のご来店をお待ちしております。
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background py-12 px-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-12 animate-fade-up">
          <div className="font-serif-en text-3xl tracking-luxury text-gold mb-2">SB</div>
          <h1 className="display text-xl mb-2">{salon.name}</h1>
          <p className="eyebrow text-[10px]">— Online Reservation —</p>
        </div>

        <div className="space-y-7 animate-fade-up animate-delay-100">
          <div>
            <p className="eyebrow mb-3">No.01 — Your Name</p>
            <Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
              placeholder="山田 花子" className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">No.02 — Phone</p>
            <Input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
              placeholder="09012345678" className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">No.03 — Email (optional)</p>
            <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">No.04 — Date</p>
            <Input type="date" min={minDate} value={form.date} onChange={e => setForm({...form, date: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">No.05 — Time</p>
            <div className="grid grid-cols-5 gap-px bg-border">
              {TIMES.map(t => (
                <button key={t} type="button" onClick={() => setForm({...form, time: t})}
                  className={`py-3 text-sm font-serif transition-all ${form.time === t ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow mb-3">No.06 — Menu</p>
            <div className="grid grid-cols-2 gap-px bg-border">
              {salon.menus.map(m => (
                <button key={m} type="button" onClick={() => setForm({...form, menu: m})}
                  className={`py-3 text-sm font-serif transition-all ${form.menu === m ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="eyebrow mb-3 block">Notes (optional)</Label>
            <Textarea rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold resize-none" />
          </div>

          <Button onClick={handleSubmit} disabled={submitting}
            className="w-full rounded-none py-7 text-xs tracking-luxury bg-primary hover:bg-primary-glow shadow-elegant" size="lg">
            {submitting && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
            CONFIRM RESERVATION
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PublicBooking;
