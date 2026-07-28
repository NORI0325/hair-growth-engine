import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { AlertTriangle, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Trash2, RefreshCcw } from "lucide-react";
import SyncStatusDialog from "@/components/SyncStatusDialog";
import { getExternalMirrorWarnings, isExternalMirrorBooking } from "@/lib/external-booking";

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
  source_channel: string | null;
  external_reservation_id: string | null;
  sync_status: string | null;
  sync_error_message: string | null;
  needs_manual_review: boolean | null;
  notes: string | null;
  customers: { full_name: string; phone: string | null } | null;
}

interface CalendarMutationInfo {
  event: {
    extendedProps: { booking?: Booking };
    start: Date | null;
    end: Date | null;
    getResources: () => Array<{ id: string }>;
  };
  newResource?: { id: string };
  revert: () => void;
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
  const tenantId = useTenantId();
  const calRef = useRef<FullCalendar>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"resourceTimeGridDay" | "timeGridWeek" | "dayGridMonth">("resourceTimeGridDay");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [openHour, setOpenHour] = useState("09:00");
  const [closeHour, setCloseHour] = useState("21:00");
  const [syncOpen, setSyncOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user || !locationId) { setLoading(false); return; }
    setLoading(true);
    const [b, s, prof] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_date, booking_time, menu, status, staff_id, total_duration_minutes, customer_id, external_source, source_channel, external_reservation_id, sync_status, sync_error_message, needs_manual_review, notes, customers(full_name, phone)")
        .eq("location_id", locationId)
        .or("cancelled_source.is.null,cancelled_source.neq.salonboost_archive")
        .gte("booking_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
        .order("booking_date"),
      supabase.from("staff").select("id, name, display_color").eq("location_id", locationId).eq("active", true).order("sort_order"),
      tenantId
        ? supabase.from("salon_hours").select("open_time, close_time")
          .eq("owner_id", tenantId).eq("location_id", locationId).eq("closed", false)
          .order("open_time", { ascending: true }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (b.data) setBookings(b.data as unknown as Booking[]);
    setStaff((s.data as Staff[]) || []);
    if (prof.data) {
      const hours = prof.data as { open_time?: string | null; close_time?: string | null };
      setOpenHour((hours.open_time || "09:00:00").slice(0, 5));
      setCloseHour((hours.close_time || "21:00:00").slice(0, 5));
    }
    setLoading(false);
  }, [user, locationId, tenantId]);

  useEffect(() => { void load(); }, [load]);

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
      const isMirror = isExternalMirrorBooking(b);
      const needsReview = b.needs_manual_review === true
        || b.sync_status === "needs_review"
        || b.total_duration_minutes == null;
      return {
        id: b.id,
        resourceId: b.staff_id || "_unassigned",
        title: `${needsReview ? "要確認 " : ""}${isMirror ? "外部 " : ""}${b.customers?.full_name || "—"} / ${b.menu}`,
        start,
        end,
        editable: !isMirror,
        startEditable: !isMirror,
        durationEditable: !isMirror,
        resourceEditable: !isMirror,
        backgroundColor: c.bg,
        borderColor: needsReview ? "hsl(0 72% 48%)" : isMirror ? "hsl(35 85% 45%)" : c.bg,
        textColor: c.text,
        extendedProps: { booking: b },
      };
    });
  }, [bookings]);

  const switchView = (v: typeof view) => {
    setView(v);
    calRef.current?.getApi().changeView(v);
  };

  // ドラッグ/リサイズ/担当変更を検知し、サロンボード側へ自動同期
  const onEventChange = async (info: CalendarMutationInfo) => {
    const b: Booking | undefined = info.event.extendedProps?.booking;
    if (!b) return;
    if (b.status === "cancelled") { info.revert(); toast.warning("キャンセル済の予約は変更できません"); return; }
    if (isExternalMirrorBooking(b)) {
      info.revert();
      toast.warning("外部予約はSalonBoostから変更できません。サロンボード本体で確認・変更してください。");
      return;
    }

    const start = info.event.start;
    if (!start) {
      info.revert();
      toast.error("変更後の開始時刻を取得できませんでした");
      return;
    }
    const end: Date | null = info.event.end;
    const newDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    const newTime = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}:00`;
    const dur = end ? Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000)) : (b.total_duration_minutes ?? 60);
    const newResource = info.newResource ?? info.event.getResources()?.[0];
    const newStaffId = newResource ? (newResource.id === "_unassigned" ? null : newResource.id) : b.staff_id;

    const updates = { booking_date: newDate, booking_time: newTime, total_duration_minutes: dur, staff_id: newStaffId };
    const { error } = await supabase.from("bookings").update(updates).eq("id", b.id);
    if (error) { info.revert(); toast.error("更新失敗: " + error.message); return; }

    // サロンボード反映（external_reservation_id がある予約のみ）
    if (b.external_reservation_id) {
      const { data, error: syncError } = await supabase.functions.invoke("sync-update-to-salonboard", {
        body: { booking_id: b.id },
      });
      const result = data as { success?: boolean; skipped?: boolean; reason?: string } | null;
      if (syncError || !result?.success) {
        const { error: rollbackError } = await supabase.from("bookings").update({
          booking_date: b.booking_date,
          booking_time: b.booking_time,
          total_duration_minutes: b.total_duration_minutes,
          staff_id: b.staff_id,
          sync_status: "needs_review",
          needs_manual_review: true,
          sync_error_message: "変更同期を開始できなかったため、画面上の変更を取り消しました。",
        }).eq("id", b.id);
        info.revert();
        console.error("[sync-update] rejected", { syncError, result, rollbackError });
        toast.error("サロンボード同期を開始できなかったため変更を取り消しました");
        await load();
        return;
      }
      toast.success("予約変更を保存し、サロンボード同期を開始しました");
    } else {
      toast.success("予約を更新しました");
    }
    await load();
  };

  const updateStatus = async (booking: Booking, status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show") => {
    if (isExternalMirrorBooking(booking)) {
      toast.warning("外部予約の状態はSalonBoostから変更できません。サロンボード本体で操作してください。");
      return;
    }
    if (status === "cancelled" || status === "no_show") {
      const { data, error } = await supabase.functions.invoke("sync-cancel-to-salonboard", {
        body: { booking_id: booking.id, no_show: status === "no_show" },
      });
      const result = data as { success?: boolean } | null;
      if (error || !result?.success) {
        console.error("[sync-cancel] rejected", { error, result });
        toast.error("キャンセル同期を開始できなかったため、予約状態は変更していません");
        return;
      }
      if (status === "no_show") {
        await supabase.from("bookings").update({ status: "no_show" }).eq("id", booking.id);
      }
    } else {
      const { error } = await supabase.from("bookings").update({ status }).eq("id", booking.id);
      if (error) { toast.error("更新失敗: " + error.message); return; }
    }
    toast.success("ステータスを更新しました");
    setSelected(null);
    load();
  };

  const cancelBooking = async (booking: Booking) => {
    if (isExternalMirrorBooking(booking)) {
      toast.warning("外部予約はSalonBoostからキャンセルできません。サロンボード本体で操作してください。");
      return;
    }
    if (!confirm("この予約をキャンセル扱いにします。よろしいですか？\n（あとで「キャンセルを取り消す」から復元できます）")) return;
    await updateStatus(booking, "cancelled");
  };

  const deleteBooking = async (booking: Booking) => {
    if (isExternalMirrorBooking(booking)) {
      toast.warning("外部予約はSalonBoostから削除できません。サロンボード本体で確認してください。");
      return;
    }
    if (booking.status !== "cancelled" && booking.status !== "completed") {
      toast.warning("予約をアーカイブする前に、キャンセルまたは来店済へ変更してください。");
      return;
    }
    const archiveNote = [booking.notes, `[${new Date().toISOString()}] SalonBoostでアーカイブ`].filter(Boolean).join("\n");
    const { error } = await supabase.from("bookings").update({
      cancelled_source: "salonboost_archive",
      notes: archiveNote.slice(0, 2000),
    }).eq("id", booking.id);
    if (error) { toast.error("アーカイブ失敗: " + error.message); return; }
    toast.success("予約をアーカイブしました");
    setSelected(null);
    load();
  };

  const restoreBooking = async () => {
    if (!confirm("この予約のキャンセルを取り消し、「確定」に戻します。よろしいですか？")) return;
    if (!selected) return;
    await updateStatus(selected, "confirmed");
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
            eventClick={(info) => {
              const booking = info.event.extendedProps.booking as Booking | undefined;
              if (booking) setSelected(booking);
            }}
            editable
            eventStartEditable
            eventDurationEditable
            eventResourceEditable
            eventDrop={onEventChange}
            eventResize={onEventChange}
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
              {getExternalMirrorWarnings(selected).length > 0 && (
                <div className="border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 space-y-1">
                  {getExternalMirrorWarnings(selected).map((warning) => (
                    <div key={warning} className="flex items-start gap-2 text-xs leading-relaxed">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
              <Row label="お客様">{selected.customers?.full_name || "—"} {selected.customers?.phone && <span className="text-muted-foreground text-xs">/ {selected.customers.phone}</span>}</Row>
              <Row label="日時">
                {selected.booking_date} {selected.booking_time?.slice(0, 5)}
                （{selected.total_duration_minutes == null ? "所要時間未取得" : `${selected.total_duration_minutes}分`}）
              </Row>
              <Row label="メニュー">{selected.menu}</Row>
              <Row label="担当">{staff.find((s) => s.id === selected.staff_id)?.name || "未割当"}</Row>
              <Row label="ステータス">{selected.status}</Row>
              {selected.external_source && <Row label="取込元"><span className="eyebrow text-[10px]">{selected.external_source}</span></Row>}
              {selected.source_channel && <Row label="チャネル"><span className="eyebrow text-[10px]">{selected.source_channel}</span></Row>}
              {selected.sync_status && <Row label="同期状態"><span className="eyebrow text-[10px]">{selected.sync_status}</span></Row>}
              <div className="flex gap-2 pt-3 border-t border-border flex-wrap">
                <Link
                  to={`/customers/${selected.customer_id}/chart`}
                  className="inline-flex items-center gap-1.5 px-3 h-8 border border-gold/50 text-gold hover:bg-gold hover:text-background transition-colors text-xs tracking-luxury"
                >
                  <FileText className="w-3.5 h-3.5" />
                  カルテを開く
                </Link>
                <Button size="sm" variant="outline" className="rounded-none" onClick={() => setSyncOpen(true)}>
                  <RefreshCcw className="w-3.5 h-3.5 mr-1" />同期状態を確認
                </Button>
                {selected.status === "pending" && (
                  <Button
                    size="sm"
                    className="rounded-none"
                    disabled={isExternalMirrorBooking(selected) && (selected.needs_manual_review || selected.sync_status === "needs_review")}
                    title={isExternalMirrorBooking(selected) ? "要確認の外部予約はサロンボード本体で確認してください" : undefined}
                    onClick={() => updateStatus(selected, "confirmed")}
                  >
                    確定にする
                  </Button>
                )}
                {(selected.status === "pending" || selected.status === "confirmed") && (
                  <Button size="sm" className="rounded-none" onClick={() => updateStatus(selected, "completed")}>来店済にする</Button>
                )}
                {(selected.status === "pending" || selected.status === "confirmed") && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="rounded-none"
                    disabled={isExternalMirrorBooking(selected)}
                    title={isExternalMirrorBooking(selected) ? "外部予約はSalonBoostからキャンセルできません" : undefined}
                    onClick={() => cancelBooking(selected)}
                  >
                    予約をキャンセル
                  </Button>
                )}
                {selected.status === "cancelled" && (
                  <Button size="sm" className="rounded-none" onClick={() => restoreBooking()}>キャンセルを取り消す</Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-none text-muted-foreground hover:text-destructive"
                      title={isExternalMirrorBooking(selected) ? "外部予約はSalonBoostからアーカイブできません" : "予約をアーカイブ"}
                      disabled={isExternalMirrorBooking(selected) || (selected.status !== "cancelled" && selected.status !== "completed")}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />アーカイブ
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-none">
                    <AlertDialogHeader>
                    <AlertDialogTitle>この予約をアーカイブしますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                        予約データは監査のため保持し、通常の一覧から非表示にします。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-none">キャンセル</AlertDialogCancel>
                      <AlertDialogAction className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteBooking(selected)}>
                        アーカイブする
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button size="sm" variant="outline" className="rounded-none ml-auto" onClick={() => setSelected(null)}>閉じる</Button>
              </div>
              {selected.status === "cancelled" && (
                <p className="text-[11px] text-muted-foreground">※「キャンセルを取り消す」を押すと予約が「確定」状態に戻ります。</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selected && (
        <SyncStatusDialog bookingId={selected.id} open={syncOpen} onOpenChange={setSyncOpen} booking={selected} />
      )}
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
