import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

import FullCalendar from "@fullcalendar/react";
import resourceTimegridPlugin from "@fullcalendar/resource-timegrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import jaLocale from "@fullcalendar/core/locales/ja";

interface Staff { id: string; name: string; display_color: string; }
interface Booking {
  id: string;
  booking_date: string;
  booking_time: string;
  menu: string;
  status: string;
  staff_id: string | null;
  total_duration_minutes: number | null;
  customer_id: string;
  external_source: string | null;
  customers: { full_name: string; phone: string | null } | null;
}

const statusColor = (s: string) => {
  if (s === "completed") return { bg: "hsl(142 71% 35%)", text: "#fff" };
  if (s === "confirmed") return { bg: "hsl(43 65% 45%)", text: "#fff" };
  if (s === "cancelled") return { bg: "hsl(0 70% 50%)", text: "#fff" };
  if (s === "no_show") return { bg: "hsl(0 0% 50%)", text: "#fff" };
  return { bg: "hsl(220 14% 60%)", text: "#fff" }; // pending
};

const CalendarPage = () => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const calRef = useRef<FullCalendar>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"resourceTimeGridDay" | "timeGridWeek" | "dayGridMonth">("resourceTimeGridDay");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [openHour, setOpenHour] = useState("09:00");
  const [closeHour, setCloseHour] = useState("21:00");

  const load = async () => {
    if (!user || !locationId) { setLoading(false); return; }
    setLoading(true);
    const [b, s, prof] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_date, booking_time, menu, status, staff_id, total_duration_minutes, customer_id, external_source, customers(full_name, phone)")
        .eq("location_id", locationId)
        .gte("booking_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
        .order("booking_date"),
      supabase.from("staff").select("id, name, display_color").eq("location_id", locationId).eq("active", true).order("sort_order"),
      supabase.from("profiles").select("open_time, close_time").eq("id", user.id).maybeSingle(),
    ]);
    if (b.data) setBookings(b.data as any);
    setStaff((s.data as Staff[]) || []);
    if (prof.data) {
      setOpenHour(((prof.data as any).open_time || "09:00:00").slice(0, 5));
      setCloseHour(((prof.data as any).close_time || "21:00:00").slice(0, 5));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, locationId]);

  const resources = useMemo(() => {
    const items = staff.map((s) => ({ id: s.id, title: s.name, eventColor: s.display_color }));
    items.push({ id: "_unassigned", title: "未割当", eventColor: "#999" });
    return items;
  }, [staff]);

  const events = useMemo(() => {
    return bookings.map((b) => {
      const dur = b.total_duration_minutes ?? 60;
      const start = `${b.booking_date}T${b.booking_time}`;
      const end = new Date(new Date(start).getTime() + dur * 60000).toISOString();
      const c = statusColor(b.status);
      return {
        id: b.id,
        resourceId: b.staff_id || "_unassigned",
        title: `${b.customers?.full_name || "—"} / ${b.menu}`,
        start,
        end,
        backgroundColor: c.bg,
        borderColor: c.bg,
        textColor: c.text,
        extendedProps: { booking: b },
      };
    });
  }, [bookings]);

  const switchView = (v: typeof view) => {
    setView(v);
    calRef.current?.getApi().changeView(v);
  };

  const updateStatus = async (id: string, status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show") => {
    const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
    if (error) { toast.error("更新失敗: " + error.message); return; }
    toast.success("ステータスを更新しました");
    setSelected(null);
    load();
  };

  const cancelBooking = async (id: string) => {
    if (!confirm("この予約をキャンセル扱いにします。よろしいですか？\n（あとで「キャンセルを取り消す」から復元できます）")) return;
    await updateStatus(id, "cancelled");
  };

  const restoreBooking = async (id: string) => {
    if (!confirm("この予約のキャンセルを取り消し、「確定」に戻します。よろしいですか？")) return;
    await updateStatus(id, "confirmed");
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.04 — Calendar"
        title="予約カレンダー"
        description="スタッフ別タイムグリッド表示で空き時間と稼働状況を一望できます"
      />

      <div className="flex items-center gap-2 mb-6">
        <Button size="sm" variant={view === "resourceTimeGridDay" ? "default" : "outline"} className="rounded-none" onClick={() => switchView("resourceTimeGridDay")}>日（スタッフ別）</Button>
        <Button size="sm" variant={view === "timeGridWeek" ? "default" : "outline"} className="rounded-none" onClick={() => switchView("timeGridWeek")}>週</Button>
        <Button size="sm" variant={view === "dayGridMonth" ? "default" : "outline"} className="rounded-none" onClick={() => switchView("dayGridMonth")}>月</Button>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <Legend color={statusColor("pending").bg} label="未確定" />
          <Legend color={statusColor("confirmed").bg} label="確定" />
          <Legend color={statusColor("completed").bg} label="来店済" />
          <Legend color={statusColor("cancelled").bg} label="キャンセル" />
        </div>
      </div>

      {loading ? (
        <div className="py-24 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" /></div>
      ) : (
        <div className="border border-border bg-background salon-calendar">
          <FullCalendar
            ref={calRef}
            plugins={[resourceTimegridPlugin, timeGridPlugin, dayGridPlugin, interactionPlugin]}
            initialView={view}
            schedulerLicenseKey="CC-Attribution-NonCommercial-NoDerivatives"
            locale={jaLocale}
            timeZone="local"
            headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
            slotMinTime={openHour + ":00"}
            slotMaxTime={closeHour + ":00"}
            slotDuration="00:15:00"
            slotLabelInterval="01:00"
            allDaySlot={false}
            nowIndicator
            height="auto"
            resources={resources}
            events={events}
            eventClick={(info) => setSelected((info.event.extendedProps as any).booking)}
            expandRows
          />
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">予約詳細</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <Row label="お客様">{selected.customers?.full_name || "—"} {selected.customers?.phone && <span className="text-muted-foreground text-xs">/ {selected.customers.phone}</span>}</Row>
              <Row label="日時">{selected.booking_date} {selected.booking_time?.slice(0, 5)}（{selected.total_duration_minutes ?? 60}分）</Row>
              <Row label="メニュー">{selected.menu}</Row>
              <Row label="担当">{staff.find((s) => s.id === selected.staff_id)?.name || "未割当"}</Row>
              <Row label="ステータス">{selected.status}</Row>
              {selected.external_source && <Row label="取込元"><span className="eyebrow text-[10px]">{selected.external_source}</span></Row>}
              <div className="flex gap-2 pt-3 border-t border-border flex-wrap">
                <Link
                  to={`/customers/${selected.customer_id}/chart`}
                  className="inline-flex items-center gap-1.5 px-3 h-8 border border-gold/50 text-gold hover:bg-gold hover:text-background transition-colors text-xs tracking-luxury"
                >
                  <FileText className="w-3.5 h-3.5" />
                  カルテを開く
                </Link>
                {selected.status === "pending" && (
                  <Button size="sm" className="rounded-none" onClick={() => updateStatus(selected.id, "confirmed")}>確定にする</Button>
                )}
                {(selected.status === "pending" || selected.status === "confirmed") && (
                  <Button size="sm" className="rounded-none" onClick={() => updateStatus(selected.id, "completed")}>来店済にする</Button>
                )}
                {(selected.status === "pending" || selected.status === "confirmed") && (
                  <Button size="sm" variant="destructive" className="rounded-none" onClick={() => cancelBooking(selected.id)}>予約をキャンセル</Button>
                )}
                {selected.status === "cancelled" && (
                  <Button size="sm" className="rounded-none" onClick={() => restoreBooking(selected.id)}>キャンセルを取り消す</Button>
                )}
                <Button size="sm" variant="outline" className="rounded-none ml-auto" onClick={() => setSelected(null)}>閉じる</Button>
              </div>
              {selected.status === "cancelled" && (
                <p className="text-[11px] text-muted-foreground">※「キャンセルを取り消す」を押すと予約が「確定」状態に戻ります。</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

const Legend = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: color }} />{label}</span>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-4 gap-2"><span className="eyebrow text-[10px] text-muted-foreground">{label}</span><span className="col-span-3 font-serif">{children}</span></div>
);

export default CalendarPage;
