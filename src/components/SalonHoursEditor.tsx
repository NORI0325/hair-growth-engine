import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { useCurrentLocation } from "@/hooks/useLocations";

interface SalonHour {
  id: string;
  weekday: number;
  open_time: string;
  close_time: string;
  closed: boolean;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const SalonHoursEditor = () => {
  const { user } = useAuth();
  const { currentLocation, currentLocationId: locationId, isLoading: locationsLoading } = useCurrentLocation();
  const [hours, setHours] = useState<SalonHour[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) { setLoading(false); return; }
    if (!locationId) { setLoading(false); setHours([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("salon_hours")
      .select("id, weekday, open_time, close_time, closed")
      .eq("location_id", locationId)
      .order("weekday");
    if (error) {
      console.error("salon_hours load error:", error);
      toast.error("営業時間の読み込みに失敗しました: " + error.message);
    }

    let rows = (data || []) as SalonHour[];
    // 初回 or 不足曜日があれば自動シード（7曜日分を保証）
    if (rows.length < 7) {
      const existing = new Set(rows.map(r => r.weekday));
      const missing = [0, 1, 2, 3, 4, 5, 6].filter(w => !existing.has(w));
      if (missing.length > 0) {
        const seeds = missing.map(w => ({
          owner_id: user.id,
          location_id: locationId,
          weekday: w,
          open_time: "10:00:00",
          close_time: "19:00:00",
          closed: w === 1, // 月曜デフォ定休
        }));
        const { data: inserted } = await supabase
          .from("salon_hours")
          .insert(seeds)
          .select("id, weekday, open_time, close_time, closed");
        if (inserted) rows = [...rows, ...(inserted as SalonHour[])].sort((a, b) => a.weekday - b.weekday);
      }
    }
    setHours(rows);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, locationId]);

  const updateHour = async (h: SalonHour, patch: Partial<SalonHour>) => {
    setHours(prev => prev.map(x => x.id === h.id ? { ...x, ...patch } : x));
    const { error } = await supabase.from("salon_hours").update(patch).eq("id", h.id);
    if (error) {
      toast.error("更新失敗: " + error.message);
      load();
    }
  };

  const byWeekday = (w: number) => hours.find(h => h.weekday === w);

  return (
    <section className="border border-border p-8 mb-12">
      <div className="eyebrow mb-2 text-[10px] flex items-center gap-2">
        <Clock className="w-3 h-3" />— Salon Business Hours —
      </div>
      <h2 className="display text-xl mb-2">
        営業時間 / 定休日
        {currentLocation && (
          <span className="ml-3 text-xs font-sans text-gold tracking-wider">— {currentLocation.name}</span>
        )}
      </h2>
      <p className="text-xs text-muted-foreground mb-6 leading-loose">
        曜日ごとに営業時間と定休日を設定できます。<br />
        定休日に設定された曜日は、予約画面に空き枠が表示されません。
      </p>

      {locationsLoading || loading ? (
        <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" /></div>
      ) : !locationId ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          店舗が見つかりません。サイドバーで店舗を選択してください。
        </div>
      ) : (
        <div className="space-y-2">
          {WEEKDAYS.map((label, w) => {
            const h = byWeekday(w);
            if (!h) return null;
            const isWeekend = w === 0 || w === 6;
            return (
              <div key={w} className={`grid grid-cols-12 items-center gap-3 py-3 px-3 border ${h.closed ? "bg-muted/30 border-border" : "border-gold/30 bg-card"}`}>
                <div className={`col-span-2 font-serif text-sm ${isWeekend ? (w === 0 ? "text-destructive" : "text-blue-600") : ""}`}>
                  {label}曜日
                </div>
                <div className="col-span-3 flex items-center gap-2">
                  <Switch checked={!h.closed} onCheckedChange={v => updateHour(h, { closed: !v })} />
                  <span className="text-xs text-muted-foreground">{h.closed ? "定休" : "営業"}</span>
                </div>
                <div className={`col-span-7 flex items-center gap-2 ${h.closed ? "opacity-40" : ""}`}>
                  <Input type="time" value={h.open_time.slice(0, 5)} disabled={h.closed}
                    onChange={e => updateHour(h, { open_time: e.target.value + ":00" })}
                    className="rounded-none h-9 text-sm" />
                  <span className="text-xs text-muted-foreground">〜</span>
                  <Input type="time" value={h.close_time.slice(0, 5)} disabled={h.closed}
                    onChange={e => updateHour(h, { close_time: e.target.value + ":00" })}
                    className="rounded-none h-9 text-sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-6 leading-loose">
        ※ スタッフ個別の勤務時間は「スタッフ管理」ページで設定します。<br />
        　予約可能時間 = この営業時間 ∩ スタッフ勤務時間 の重なりです。
      </p>
    </section>
  );
};

export default SalonHoursEditor;
