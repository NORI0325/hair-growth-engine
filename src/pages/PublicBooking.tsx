import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, Check } from "lucide-react";
import { toast } from "sonner";

// 15分刻みの全候補（営業時間内のスロットはRPCがフィルタ）
const ALL_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 21; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

interface MenuItem {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
}

const schema = z.object({
  full_name: z.string().trim().min(1, "お名前を入力してください").max(100),
  phone: z.string().trim().min(8, "正しい電話番号を入力してください").max(20),
  email: z.string().trim().email("正しいメールアドレス").max(255).optional().or(z.literal("")),
  date: z.string().min(1, "日付を選択してください"),
  time: z.string().min(1, "時間を選択してください"),
  notes: z.string().max(500).optional(),
});

const PublicBooking = () => {
  const { slug } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [salonName, setSalonName] = useState("Salon");
  const [salonExists, setSalonExists] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [fallbackMenus, setFallbackMenus] = useState<string[]>([]);
  const [selectedMenus, setSelectedMenus] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<Record<string, number>>({});
  const [maxStaffCount, setMaxStaffCount] = useState(1);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [hasStaff, setHasStaff] = useState(false);
  const [openTime, setOpenTime] = useState<string>("10:00");
  const [closeTime, setCloseTime] = useState<string>("19:00");

  const [form, setForm] = useState({ full_name: "", phone: "", email: "", date: "", time: "", notes: "" });

  useEffect(() => {
    const load = async () => {
      if (!slug) { setLoading(false); return; }

      // まず locations.public_slug で探す（マルチ店舗対応）
      const { data: location } = await supabase
        .from("locations")
        .select("id, tenant_id, name, open_time, close_time")
        .eq("public_slug", slug)
        .maybeSingle();

      let ownerId: string | null = null;
      let locationId: string | null = null;
      let displayName = "Salon";
      let pubMenus: string[] = [];

      if (location) {
        ownerId = location.tenant_id;
        locationId = location.id;
        displayName = location.name || "Salon";
        if (location.open_time) setOpenTime(String(location.open_time).slice(0, 5));
        if (location.close_time) setCloseTime(String(location.close_time).slice(0, 5));

        // tenant の public_menus フォールバック取得
        const { data: prof } = await supabase
          .from("profiles")
          .select("public_menus")
          .eq("id", location.tenant_id)
          .maybeSingle();
        pubMenus = prof?.public_menus || [];
      } else {
        // 後方互換: profiles.public_slug で探す
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, salon_name, public_menus, open_time, close_time")
          .eq("public_slug", slug)
          .maybeSingle();
        if (profile) {
          ownerId = profile.id;
          displayName = profile.salon_name || "Salon";
          pubMenus = profile.public_menus || [];
          if (profile.open_time) setOpenTime(String(profile.open_time).slice(0, 5));
          if (profile.close_time) setCloseTime(String(profile.close_time).slice(0, 5));
        }
      }

      if (ownerId) {
        setSalonExists(true);
        setSalonName(displayName);
        setFallbackMenus(pubMenus);

        if (locationId) {
          const { data: items } = await supabase
            .from("menu_items")
            .select("id, name, duration_minutes, price")
            .eq("owner_id", ownerId)
            .eq("location_id", locationId)
            .eq("active", true)
            .order("sort_order", { ascending: true });
          setMenuItems(items || []);

          const { count } = await supabase
            .from("staff")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", ownerId)
            .eq("location_id", locationId)
            .eq("active", true)
            .eq("bookable", true);
          setHasStaff((count || 0) > 0);
          setMaxStaffCount(Math.max(1, count || 1));
        } else {
          // location_id 不明時は店舗共通(NULL)メニューや全店混在を避けるため、メニュー非表示
          setMenuItems([]);
          setHasStaff(false);
          setMaxStaffCount(1);
        }
      }
      setLoading(false);
    };
    load();
  }, [slug]);

  // タブタイトルをサロン名に差し替え（お客様視点で自然に）
  useEffect(() => {
    if (salonExists && salonName) {
      document.title = `${salonName}｜ご予約`;
    }
    return () => { document.title = "ご予約 — Salon Boost"; };
  }, [salonExists, salonName]);

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  const { totalDuration, totalPrice } = useMemo(() => {
    let d = 0, p = 0;
    for (const name of selectedMenus) {
      const item = menuItems.find(i => i.name === name);
      if (item) { d += item.duration_minutes; p += item.price; }
    }
    return { totalDuration: d, totalPrice: p };
  }, [selectedMenus, menuItems]);

  const toggleMenu = (name: string) => {
    setSelectedMenus(prev => prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name]);
  };

  // 日付・所要時間・スタッフ有無が変わったら空き枠を再取得
  useEffect(() => {
    const fetchSlots = async () => {
      if (!slug || !form.date || !hasStaff) { setAvailableSlots({}); return; }
      const duration = totalDuration > 0 ? totalDuration : 60;
      setSlotsLoading(true);
      const { data, error } = await supabase.rpc("get_available_slots" as any, {
        _salon_slug: slug,
        _date: form.date,
        _duration_minutes: duration,
      });
      setSlotsLoading(false);
      if (error || !data) { setAvailableSlots({}); return; }
      const map: Record<string, number> = {};
      for (const row of data as any[]) {
        const t = String(row.slot_time).slice(0, 5);
        map[t] = row.available_staff_count;
      }
      setAvailableSlots(map);
      // 選択中の時刻が空きでなくなったらクリア
      if (form.time && map[form.time] === undefined) {
        setForm(f => ({ ...f, time: "" }));
      }
    };
    fetchSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, form.date, totalDuration, hasStaff]);

  const handleSubmit = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    if (selectedMenus.length === 0) { toast.error("メニューを1つ以上お選びください"); return; }
    setSubmitting(true);
    const payload = {
      _salon_slug: slug!,
      _full_name: parsed.data.full_name,
      _phone: parsed.data.phone,
      _email: parsed.data.email || "",
      _booking_date: parsed.data.date,
      _booking_time: parsed.data.time,
      _menus: selectedMenus,
      _notes: parsed.data.notes || "",
    };
    console.log("[PublicBooking] submit payload:", payload);
    const { data, error } = await supabase.rpc("public_create_booking_v3" as any, payload);
    setSubmitting(false);
    console.log("[PublicBooking] response:", { data, error });
    const bookingId = (data as any)?.booking_id;
    if (error || !(data as any)?.success || !bookingId) {
      const reason = (data as any)?.error || error?.message || "unknown";
      console.error("[PublicBooking] booking failed:", reason);
      toast.error(`ご予約に失敗しました（${reason}）。お手数ですが再度お試しください。`);
      return;
    }
    if (bookingId) {
      supabase.functions.invoke("notify-owner-booking", {
        body: { bookingId, eventType: "created" },
      }).catch(() => {});
    }
    setCompleted(true);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 animate-spin text-gold" />
    </div>
  );

  if (!salonExists) return (
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

  // メニュー一覧（menu_items 優先、なければ fallback）
  const useRichMenus = menuItems.length > 0;

  return (
    <div className="min-h-screen bg-background py-12 px-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-12 animate-fade-up">
          <div className="font-serif-en text-3xl tracking-luxury text-gold mb-2">SB</div>
          <h1 className="display text-xl mb-2">{salonName}</h1>
          <p className="eyebrow text-[10px]">— Online Reservation —</p>
        </div>

        <div className="space-y-7 animate-fade-up animate-delay-100">
          <div>
            <p className="eyebrow mb-3">No.01 — お名前 / Your Name</p>
            <Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
              placeholder="山田 花子" className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">No.02 — 電話番号 / Phone</p>
            <Input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
              placeholder="09012345678" className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">No.03 — メール / Email（任意）</p>
            <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">No.04 — ご希望日 / Date</p>
            <Input type="date" min={minDate} value={form.date} onChange={e => setForm({...form, date: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <p className="eyebrow mb-3">
              No.05 — ご希望時間 / Time
              {hasStaff && slotsLoading && <Loader2 className="w-3 h-3 inline-block ml-2 animate-spin text-gold" />}
            </p>
            {hasStaff ? (
              !form.date ? (
                <p className="text-xs text-muted-foreground py-3">先に日付をお選びください</p>
              ) : (() => {
                // 営業時間内の30分刻みスロットを生成（全枠表示）
                const [oh, om] = openTime.split(":").map(Number);
                const [ch, cm] = closeTime.split(":").map(Number);
                const startMin = oh * 60 + om;
                const endMin = ch * 60 + cm;
                const businessSlots: string[] = [];
                for (let m = startMin; m < endMin; m += 30) {
                  businessSlots.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
                }
                const totalAvail = businessSlots.reduce((s, t) => s + (availableSlots[t] || 0), 0);
                const totalCap = businessSlots.length * maxStaffCount;
                const fillRatio = totalCap > 0 ? 1 - totalAvail / totalCap : 0;
                const remainingCount = businessSlots.filter(t => (availableSlots[t] || 0) > 0).length;

                return (
                  <div>
                    {/* 埋まり具合インジケーター（売れてる感の演出） */}
                    {!slotsLoading && (
                      <div className="mb-3 flex items-center justify-between text-[10px] tracking-luxury">
                        <span className="text-muted-foreground">
                          {fillRatio >= 0.7 ? (
                            <span className="text-gold">★ 残りわずか — Almost Full</span>
                          ) : fillRatio >= 0.4 ? (
                            <span className="text-gold/80">人気の日程 — Popular</span>
                          ) : (
                            <span>空きあり — Available</span>
                          )}
                        </span>
                        <span className="text-muted-foreground">残 {remainingCount} 枠</span>
                      </div>
                    )}
                    <div className="grid grid-cols-5 gap-px bg-border">
                      {businessSlots.map(t => {
                        const avail = availableSlots[t] ?? 0;
                        const isBooked = avail === 0;
                        const isSelected = form.time === t;
                        const isLowStock = !isBooked && avail === 1 && maxStaffCount > 1;
                        return (
                          <button
                            key={t}
                            type="button"
                            disabled={isBooked}
                            onClick={() => !isBooked && setForm({ ...form, time: t })}
                            className={`py-3 text-sm font-serif transition-all relative ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : isBooked
                                  ? "bg-muted/40 text-muted-foreground/50 cursor-not-allowed line-through"
                                  : isLowStock
                                    ? "bg-gold/10 text-foreground hover:bg-gold/20 border-l-2 border-gold"
                                    : "bg-card hover:bg-secondary"
                            }`}
                          >
                            {t}
                            {isBooked && (
                              <span className="absolute bottom-0.5 left-0 right-0 text-[8px] tracking-luxury opacity-70">満席</span>
                            )}
                            {!isBooked && isLowStock && (
                              <span className="absolute top-0.5 right-1 text-[8px] text-gold">残1</span>
                            )}
                            {!isBooked && avail > 1 && (
                              <span className="absolute top-1 right-1 text-[9px] opacity-40">×{avail}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {totalAvail === 0 && !slotsLoading && (
                      <p className="text-xs text-muted-foreground py-3 text-center">
                        この日はすべて満席です。別の日をお試しください。
                      </p>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="grid grid-cols-5 gap-px bg-border">
                {["10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"].map(t => (
                  <button key={t} type="button" onClick={() => setForm({...form, time: t})}
                    className={`py-3 text-sm font-serif transition-all ${form.time === t ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="eyebrow mb-3">No.06 — メニュー / Menu <span className="text-muted-foreground normal-case ml-1">（複数選択可）</span></p>

            {useRichMenus ? (
              <div className="space-y-px bg-border border border-border">
                {menuItems.map(item => {
                  const active = selectedMenus.includes(item.name);
                  return (
                    <button key={item.id} type="button" onClick={() => toggleMenu(item.name)}
                      className={`w-full flex items-center justify-between px-4 py-4 text-left transition-all ${active ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 border flex items-center justify-center ${active ? "border-primary-foreground bg-primary-foreground" : "border-border"}`}>
                          {active && <Check className="w-3 h-3 text-primary" />}
                        </div>
                        <span className="font-serif text-sm">{item.name}</span>
                      </div>
                      <div className="text-xs opacity-80 font-serif">
                        {item.duration_minutes}分 / ¥{item.price.toLocaleString()}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground border border-border p-4 bg-secondary/30">
                店舗情報を確認できませんでした。お手数ですが、店舗へお問い合わせください。
              </div>
            )}

            {useRichMenus && selectedMenus.length > 0 && (
              <div className="mt-4 p-4 border border-gold/40 bg-secondary/30 flex justify-between items-center">
                <div>
                  <p className="eyebrow text-[10px] mb-1 text-gold">— Total —</p>
                  <p className="font-serif text-sm">{selectedMenus.length}項目 / 約{totalDuration}分</p>
                </div>
                <p className="display text-2xl">¥{totalPrice.toLocaleString()}</p>
              </div>
            )}
          </div>

          <div>
            <Label className="eyebrow mb-3 block">ご要望 / Notes（任意）</Label>
            <Textarea rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold resize-none" />
          </div>

          <Button onClick={handleSubmit} disabled={submitting}
            className="w-full rounded-none py-7 text-xs tracking-luxury bg-primary hover:bg-primary-glow shadow-elegant" size="lg">
            {submitting && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
            この内容で予約する <span className="ml-2 opacity-60 text-[10px]">CONFIRM</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PublicBooking;
