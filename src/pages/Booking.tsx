import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, Check, CalendarDays, CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const FALLBACK_MENUS = ["カット", "カット＋カラー", "カット＋パーマ", "縮毛矯正", "ヘッドスパ", "その他"];
const FALLBACK_TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];

interface MenuItem {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  image_url: string | null;
  bookable?: boolean;
}

interface StaffMember {
  id: string;
  name: string;
  display_color: string;
  note: string | null;
}

async function isSalonboardSyncLive(ownerId: string, locationId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("channel_integrations" as any)
    .select("enabled, sync_enabled, connection_status")
    .eq("owner_id", ownerId)
    .eq("location_id", locationId)
    .eq("channel", "salonboard")
    .maybeSingle();
  if (error) return null;
  return Boolean(data?.enabled && data?.sync_enabled && data?.connection_status === "live");
}

async function filterSalonboardMappedMenus(ownerId: string, locationId: string, items: MenuItem[]): Promise<MenuItem[]> {
  if (items.length === 0) return items;
  const { data, error } = await supabase
    .from("menu_channel_mappings" as any)
    .select("menu_id, enabled, external_id, external_setmenu_id, rsv_term")
    .eq("owner_id", ownerId)
    .eq("location_id", locationId)
    .eq("channel", "salonboard")
    .eq("enabled", true)
    .in("menu_id", items.map((item) => item.id));
  if (error) return items;
  const mappedIds = new Set(
    (data || [])
      .filter((m: any) => (m.external_setmenu_id || m.external_id) && m.rsv_term != null)
      .map((m: any) => String(m.menu_id)),
  );
  return items.filter((item) => mappedIds.has(item.id));
}

const Booking = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [customer, setCustomer] = useState<any>(null);
  const [salonName, setSalonName] = useState("");
  const [salonSlug, setSalonSlug] = useState<string | null>(null);
  const [locationResolved, setLocationResolved] = useState<boolean>(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [selectedMenus, setSelectedMenus] = useState<string[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [completed, setCompleted] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<string[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [leadHours, setLeadHours] = useState(24);
  const [maxDaysAhead, setMaxDaysAhead] = useState(60);

  useEffect(() => {
    const load = async () => {
      if (!token) { toast.error("リンクが無効です"); setLoading(false); return; }
      const { data } = await supabase.functions.invoke("verify-booking-token", { body: { token } });
      if (data?.customer) {
        setCustomer(data.customer);
        setSalonName(data.salon_name || "Salon Boost");
        setSalonSlug(data.public_slug || null);
        setLeadHours(data.booking_lead_time_hours ?? 24);
        setMaxDaysAhead(data.booking_max_days_ahead ?? 60);

        // location_id 必須：店舗が確定できない場合は混在事故防止のためメニュー非表示
        if (data.owner_id && data.location_id) {
          setLocationResolved(true);
          const menusQuery = supabase
            .from("menu_items")
            .select("id, name, duration_minutes, price, image_url, bookable")
            .eq("owner_id", data.owner_id)
            .eq("location_id", data.location_id)
            .eq("active", true)
            .eq("bookable", true)
            .order("sort_order", { ascending: true });
          const staffQuery = supabase
            .from("staff")
            .select("id, name, display_color, note")
            .eq("owner_id", data.owner_id)
            .eq("location_id", data.location_id)
            .eq("active", true)
            .eq("bookable", true)
            .order("sort_order", { ascending: true });
          const [menusRes, staffRes] = await Promise.all([menusQuery, staffQuery]);
          const baseMenus = (menusRes.data || []) as MenuItem[];
          const salonboardLive = await isSalonboardSyncLive(data.owner_id, data.location_id);
          setMenuItems(salonboardLive ? await filterSalonboardMappedMenus(data.owner_id, data.location_id, baseMenus) : baseMenus);
          setStaffList(staffRes.data || []);
        } else {
          setMenuItems([]);
          setStaffList([]);
        }
      } else {
        toast.error("リンクが無効です");
      }
      setLoading(false);
    };
    load();
  }, [token]);

  // 予約可能日: JST基準で「今日」より過去はNG。リードタイム経過後の日付以降から
  const earliestDate = useMemo(() => {
    const d = new Date(Date.now() + leadHours * 3600_000);
    const jst = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    jst.setHours(0, 0, 0, 0);
    return jst;
  }, [leadHours]);
  const maxDate = useMemo(() => {
    const d = new Date(Date.now() + maxDaysAhead * 86400_000);
    const jst = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    jst.setHours(23, 59, 59, 999);
    return jst;
  }, [maxDaysAhead]);

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

  // 空き枠の取得（日付・メニュー・スタッフ変更時）
  useEffect(() => {
    const fetchSlots = async () => {
      if (!date || !salonSlug) { setAvailableSlots(null); return; }
      const duration = totalDuration > 0 ? totalDuration : 60;
      setLoadingSlots(true);
      setTime("");
      const { data, error } = await supabase.rpc("get_available_slots_by_staff", {
        _salon_slug: salonSlug,
        _date: date,
        _duration_minutes: duration,
        _staff_id: selectedStaffId,
      });
      setLoadingSlots(false);
      if (error) { console.error(error); setAvailableSlots([]); return; }
      const slots = (data || []).map((r: any) => String(r.slot_time).slice(0, 5));
      setAvailableSlots(slots);
    };
    fetchSlots();
  }, [date, totalDuration, salonSlug, selectedStaffId]);

  const handleBook = async () => {
    if (!date || !time || selectedMenus.length === 0) {
      toast.error("日付・時間・メニューをお選びください");
      return;
    }
    setBooking(true);
    const { data, error } = await supabase.functions.invoke("create-booking", {
      body: { token, date, time, menus: selectedMenus, notes, staff_id: selectedStaffId },
    });
    setBooking(false);
    if (error || !data?.success) {
      const msg = (data as any)?.message || "予約に失敗しました。もう一度お試しください。";
      toast.error(msg);
      if ((data as any)?.error === "slot_taken" && salonSlug) {
        const duration = totalDuration > 0 ? totalDuration : 60;
        const { data: slots } = await supabase.rpc("get_available_slots_by_staff", {
          _salon_slug: salonSlug, _date: date, _duration_minutes: duration, _staff_id: selectedStaffId,
        });
        setAvailableSlots((slots || []).map((r: any) => String(r.slot_time).slice(0, 5)));
        setTime("");
      }
      return;
    }
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

  if (!locationResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full text-center">
          <p className="eyebrow mb-4">— Notice —</p>
          <h2 className="display text-2xl mb-4">店舗情報を確認できませんでした</h2>
          <div className="hairline w-16 mx-auto mb-6" />
          <p className="text-sm text-muted-foreground leading-loose">
            お手数ですが、LINEまたは店舗へお問い合わせください。
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
            <div className="flex justify-between"><span className="font-serif text-muted-foreground">日付</span><span className="font-serif">{new Date(date).toLocaleDateString("ja-JP")}</span></div>
            <div className="flex justify-between"><span className="font-serif text-muted-foreground">時間</span><span className="font-serif">{time}</span></div>
            <div className="flex justify-between"><span className="font-serif text-muted-foreground">メニュー</span><span className="font-serif text-right">{selectedMenus.join(" + ")}</span></div>
            <div className="flex justify-between"><span className="font-serif text-muted-foreground">サロン</span><span className="font-serif">{salonName}</span></div>
          </div>
          <div className="mt-10">
            <Link to={`/my-bookings/${token}`}
              className="inline-flex items-center gap-2 text-[11px] eyebrow text-gold border-b border-gold/40 pb-1 hover:opacity-70">
              <CalendarDays className="w-3 h-3" /> ご予約の確認・変更はこちら
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const useRichMenus = menuItems.length > 0;

  return (
    <div className="min-h-screen bg-background py-12 px-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8 animate-fade-up">
          <div className="font-serif-en text-3xl tracking-luxury text-gold mb-2">SB</div>
          <h1 className="display text-xl">{salonName}</h1>
        </div>

        <div className="text-center mb-10">
          <Link to={`/my-bookings/${token}`}
            className="inline-flex items-center gap-2 text-[11px] eyebrow text-gold border-b border-gold/40 pb-1 hover:opacity-70">
            <CalendarDays className="w-3 h-3" /> ご予約の確認・変更
          </Link>
        </div>

        <div className="border border-gold/40 mb-12 p-10 text-center bg-secondary/30 animate-fade-up animate-delay-100 relative">
          <div className="absolute top-0 left-0 w-full h-px bg-gold" />
          <div className="absolute bottom-0 left-0 w-full h-px bg-gold" />
          <p className="eyebrow mb-3 text-gold">— Special Invitation —</p>
          <p className="font-serif text-sm text-muted-foreground mb-4">{customer.full_name} 様へ</p>
          <h2 className="display text-2xl md:text-3xl mb-4">お久しぶりクーポン</h2>
          <div className="hairline w-12 mx-auto my-4 opacity-60" />
          <p className="text-xs text-muted-foreground leading-loose">
            ご来店の際、スタッフへこの画面をご提示ください。
          </p>
        </div>

        <div className="space-y-8 animate-fade-up animate-delay-200">
          <div>
            <p className="eyebrow mb-3">
              No.01 — ご希望日 / Date
              <span className="text-muted-foreground normal-case ml-2 text-[10px]">
                （最短 {leadHours}時間後 〜 {maxDaysAhead}日先まで）
              </span>
            </p>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-serif rounded-none border-x-0 border-t-0 px-0 h-12 hover:bg-transparent",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-gold" />
                  {date ? format(new Date(date + "T00:00:00"), "yyyy年M月d日 (E)", { locale: ja }) : "日付をお選びください"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                <Calendar
                  mode="single"
                  locale={ja}
                  selected={date ? new Date(date + "T00:00:00") : undefined}
                  onSelect={(d) => {
                    if (!d) return;
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, "0");
                    const day = String(d.getDate()).padStart(2, "0");
                    setDate(`${y}-${m}-${day}`);
                  }}
                  disabled={(d) => d < earliestDate || d > maxDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          {staffList.length > 0 && (
            <div>
              <p className="eyebrow mb-3">
                スタッフ指名 / Staff <span className="text-muted-foreground normal-case ml-1 text-[10px]">（任意）</span>
              </p>
              <div className="grid grid-cols-2 gap-px bg-border">
                <button
                  type="button"
                  onClick={() => setSelectedStaffId(null)}
                  className={`py-3 px-3 text-xs font-serif transition-all flex items-center justify-center gap-2 ${selectedStaffId === null ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}
                >
                  指名なし
                  <span className="opacity-60 text-[10px]">おまかせ</span>
                </button>
                {staffList.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedStaffId(s.id)}
                    className={`py-3 px-3 text-xs font-serif transition-all flex items-center justify-center gap-2 ${selectedStaffId === s.id ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: s.display_color }}
                    />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="eyebrow mb-3">
              No.02 — ご希望時間 / Time
              {date && (
                <span className="text-muted-foreground normal-case ml-2 text-[10px]">
                  {selectedMenus.length === 0
                    ? "（先にメニューをお選びいただくと、所要時間に合わせた空き枠を表示します）"
                    : loadingSlots
                      ? "（空き枠を確認中...）"
                      : availableSlots && availableSlots.length > 0
                        ? `（${availableSlots.length}枠 空きあり）`
                        : "（この日の空き枠はございません）"}
                </span>
              )}
            </p>
            {!date ? (
              <p className="text-xs text-muted-foreground py-4">日付をお選びください</p>
            ) : loadingSlots ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-gold" />
              </div>
            ) : availableSlots !== null && availableSlots.length === 0 ? (
              <div className="border border-border bg-secondary/30 px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground leading-loose">
                  この日のご希望時間帯は満席です。<br />
                  別の日をお選びくださいませ。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-px bg-border">
                {(availableSlots || FALLBACK_TIMES).map(t => (
                  <button key={t} type="button" onClick={() => setTime(t)}
                    className={`py-3 text-xs font-serif transition-all ${time === t ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="eyebrow mb-3">No.03 — メニュー / Menu <span className="text-muted-foreground normal-case ml-1">（複数選択可）</span></p>
            {useRichMenus ? (
              <div className="space-y-px bg-border border border-border">
                {menuItems.map(item => {
                  const active = selectedMenus.includes(item.name);
                  return (
                    <button key={item.id} type="button" onClick={() => toggleMenu(item.name)}
                      className={`w-full flex items-stretch text-left transition-all ${active ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
                      {item.image_url ? (
                        <div className="w-20 h-20 flex-shrink-0 overflow-hidden bg-muted">
                          <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      ) : null}
                      <div className="flex-1 flex items-center justify-between px-4 py-4 gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center ${active ? "border-primary-foreground bg-primary-foreground" : "border-border"}`}>
                            {active && <Check className="w-3 h-3 text-primary" />}
                          </div>
                          <span className="font-serif text-sm truncate">{item.name}</span>
                        </div>
                        <div className="text-xs opacity-80 font-serif flex-shrink-0 text-right">
                          {item.duration_minutes}分<br/>¥{item.price.toLocaleString()}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground border border-border p-4 bg-secondary/30">
                メニューが登録されていません。お手数ですが、店舗へお問い合わせください。
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
            <Label htmlFor="notes" className="eyebrow mb-3 block">ご要望 / Notes（任意）</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold resize-none" />
          </div>

          <Button onClick={handleBook} disabled={booking} className="w-full rounded-none py-7 text-xs tracking-luxury bg-primary hover:bg-primary-glow shadow-elegant" size="lg">
            {booking ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
            この内容で予約する <span className="ml-2 opacity-60 text-[10px]">CONFIRM</span>
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
