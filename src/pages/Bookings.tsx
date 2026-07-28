import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, MessageCircle, Trash2, FileText, AlertTriangle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerMessageDialog } from "@/components/CustomerMessageDialog";
import { useCurrentLocationId } from "@/hooks/useLocations";
import ManualBookingDialog from "@/components/ManualBookingDialog";
import { getExternalMirrorWarnings, isExternalMirrorBooking } from "@/lib/external-booking";

const PAGE_SIZE = 250;

interface Booking {
  id: string;
  booking_date: string;
  booking_time: string;
  menu: string;
  notes: string | null;
  status: string;
  revenue: number | null;
  campaign_id: string | null;
  is_test: boolean;
  staff_id: string | null;
  customer_id: string;
  created_at: string;
  external_source: string | null;
  source_channel: string | null;
  sync_status: string | null;
  sync_error_message: string | null;
  external_reservation_id: string | null;
  needs_manual_review: boolean | null;
  total_duration_minutes: number | null;
  cancelled_source: string | null;
  customers: { full_name: string; phone: string | null; line_user_id: string | null } | null;
}

interface Staff { id: string; name: string; display_color: string; }

type SortMode = "schedule" | "received";

const statusInfo = (s: string) => {
  if (s === "confirmed") return { label: "確定", color: "text-gold" };
  if (s === "completed") return { label: "来店済", color: "text-success" };
  if (s === "cancelled") return { label: "キャンセル", color: "text-destructive" };
  return { label: "未確定", color: "text-muted-foreground" };
};

const sourceLabel = (s: string | null): string | null => {
  if (!s || s === "manual") return null;
  const map: Record<string, string> = {
    hotpepper: "HotPepper",
    minimo: "minimo",
    rakuten_beauty: "楽天Beauty",
    salonboard: "SalonBoard",
  };
  return map[s] || s;
};

const Bookings = () => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [messageBooking, setMessageBooking] = useState<Booking | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("schedule");

  const load = useCallback(async (reset = true, requestedOffset = 0) => {
    if (!user || !locationId) { setBookings([]); setStaff([]); setLoading(false); return; }
    if (reset) setLoading(true);
    else setLoadingMore(true);
    const offset = reset ? 0 : requestedOffset;
    const [b, s] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, customer_id, booking_date, booking_time, menu, notes, status, revenue, campaign_id, is_test, staff_id, created_at, external_source, source_channel, sync_status, sync_error_message, external_reservation_id, needs_manual_review, total_duration_minutes, cancelled_source, customers(full_name, phone, line_user_id)")
        .eq("location_id", locationId)
        .or("cancelled_source.is.null,cancelled_source.neq.salonboost_archive")
        .order("booking_date", { ascending: true })
        .order("booking_time", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1),
      supabase.from("staff").select("id, name, display_color").eq("location_id", locationId).eq("active", true).order("sort_order"),
    ]);
    const page = (b.data ?? []) as Booking[];
    if (reset) setBookings(page);
    else setBookings((current) => {
      const byId = new Map(current.map((booking) => [booking.id, booking]));
      page.forEach((booking) => byId.set(booking.id, booking));
      return Array.from(byId.values());
    });
    setHasMore(page.length === PAGE_SIZE);
    setStaff((s.data as Staff[]) || []);
    setLoading(false);
    setLoadingMore(false);
  }, [user, locationId]);

  useEffect(() => { void load(); }, [load]);

  const assignStaff = async (booking: Booking, staffId: string | null) => {
    if (isExternalMirrorBooking(booking)) {
      toast.warning("外部予約はSalonBoostから担当変更できません。元の予約管理画面で確認してください。");
      return;
    }
    const { error } = await supabase.from("bookings").update({ staff_id: staffId }).eq("id", booking.id);
    if (error) { toast.error("担当変更に失敗: " + error.message); return; }
    if (booking.external_reservation_id) {
      const { data, error: syncError } = await supabase.functions.invoke("sync-update-to-salonboard", {
        body: { booking_id: booking.id },
      });
      const result = data as { success?: boolean } | null;
      if (syncError || !result?.success) {
        const { error: rollbackError } = await supabase.from("bookings").update({
          staff_id: booking.staff_id,
          sync_status: "needs_review",
          needs_manual_review: true,
          sync_error_message: "担当変更同期を開始できなかったため、担当を元に戻しました。",
        }).eq("id", booking.id);
        console.error("[bookings.assignStaff] sync rejected", { syncError, result, rollbackError });
        toast.error("サロンボード同期を開始できなかったため担当を元に戻しました");
        await load();
        return;
      }
      toast.success("担当変更を保存し、サロンボード同期を開始しました");
    } else {
      toast.success("担当スタッフを更新しました");
    }
    await load();
  };

  const updateStatus = async (booking: Booking, status: "completed" | "cancelled" | "confirmed", revenue?: number) => {
    if (isExternalMirrorBooking(booking)) {
      toast.warning("外部予約の状態はSalonBoostから変更できません。元の予約管理画面で操作してください。");
      return;
    }
    if (status === "cancelled") {
      const { data, error } = await supabase.functions.invoke("sync-cancel-to-salonboard", {
        body: { booking_id: booking.id },
      });
      const result = data as { success?: boolean } | null;
      if (error || !result?.success) {
        console.error("[bookings.cancel] rejected", { error, result });
        toast.error("キャンセル同期を開始できなかったため、予約状態は変更していません");
        return;
      }
      await supabase.functions.invoke("notify-owner-booking", {
        body: { bookingId: booking.id, eventType: "cancelled" },
      }).catch(() => undefined);
      toast.success("予約をキャンセルしました");
      await load();
      return;
    }
    const update: { status: "completed" | "confirmed"; revenue?: number } = { status };
    if (revenue != null) update.revenue = revenue;
    const { data, error } = await supabase.from("bookings").update(update).eq("id", booking.id).select();
    if (error) {
      console.error("[bookings.update] error:", error);
      toast.error("更新に失敗しました：" + (error.message || "不明なエラー"));
      return;
    }
    if (!data || data.length === 0) {
      console.warn("[bookings.update] 0 rows updated. Possible RLS or auth issue. id=", booking.id);
      toast.error("更新できませんでした。再ログイン後にお試しください。");
      return;
    }
    toast.success("ステータスを更新しました");
    await load();
  };

  const handleComplete = (b: Booking) => {
    const input = window.prompt(`${b.customers?.full_name || "お客様"}様の売上金額を入力してください（¥）`, "0");
    if (input === null) return;
    const amount = parseInt(input.replace(/[^\d]/g, ""), 10);
    if (isNaN(amount) || amount < 0) { toast.error("正しい金額を入力してください"); return; }
    updateStatus(b, "completed", amount);
  };

  const removeBooking = async (booking: Booking) => {
    if (isExternalMirrorBooking(booking)) {
      toast.warning("外部予約はSalonBoostから削除できません。元の予約管理画面で確認してください。");
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
    if (error) { toast.error("アーカイブに失敗しました：" + error.message); return; }
    toast.success("予約をアーカイブしました");
    setBookings((prev) => prev.filter((b) => b.id !== booking.id));
  };

  const resyncBooking = async (b: Booking) => {
    if (isExternalMirrorBooking(b)) {
      toast.warning("外部予約はSalonBoostからサロンボードへ再送できません。元の予約管理画面で確認してください。");
      return;
    }
    const t = toast.loading("サロンボードへ再同期中…");
    const { error } = await supabase.functions.invoke("sync-resend-to-salonboard", {
      body: { booking_id: b.id },
    });
    toast.dismiss(t);
    if (error) { toast.error("再同期失敗：" + error.message); return; }
    toast.success("再同期キューに登録しました");
    load();
  };

  const isUrgent = (b: Booking): boolean => {
    if (b.status === "cancelled" || b.status === "completed") return false;
    const failed = b.sync_status === "failed" || b.sync_status === "needs_review" || b.sync_status === "pending_sync";
    const lineMissing = b.source_channel === "line" && !b.external_reservation_id && b.status !== "cancelled";
    if (!failed && !lineMissing) return false;
    const startMs = new Date(`${b.booking_date}T${b.booking_time}`).getTime();
    const now = Date.now();
    return startMs - now < 24 * 60 * 60 * 1000 && startMs > now - 60 * 60 * 1000;
  };

  const urgentBookings = bookings.filter(isUrgent).sort((a, b) =>
    new Date(`${a.booking_date}T${a.booking_time}`).getTime() - new Date(`${b.booking_date}T${b.booking_time}`).getTime()
  );

  const flatByReceived = [...bookings].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const grouped = bookings.reduce((acc, b) => {
    if (!acc[b.booking_date]) acc[b.booking_date] = [];
    acc[b.booking_date].push(b);
    return acc;
  }, {} as Record<string, Booking[]>);

  const fmtReceived = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.05 — Bookings"
        title="予約"
        description={`${bookings.length} 件の再会が予定されています`}
      />

      <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
        <ManualBookingDialog onCreated={load} />
        <div className="inline-flex border border-border">
          <button
            className={`px-4 py-2 text-xs tracking-luxury ${sortMode === "schedule" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setSortMode("schedule")}
          >
            予定日時順
          </button>
          <button
            className={`px-4 py-2 text-xs tracking-luxury border-l border-border ${sortMode === "received" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setSortMode("received")}
          >
            受信日時順
          </button>
        </div>
      </div>

      {urgentBookings.length > 0 && (
        <div className="mb-10 border-2 border-destructive bg-destructive/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <span className="font-serif text-sm text-destructive">
              緊急：サロンボード未反映の可能性がある予約 {urgentBookings.length} 件
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            来店24時間以内、または同期失敗中の予約です。至急サロンボードへ手動登録、または再同期してください。
          </p>
          <div className="space-y-2">
            {urgentBookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 bg-background/60 px-3 py-2 border border-destructive/30 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-serif">
                    {b.booking_date} {b.booking_time?.slice(0, 5)} / {b.customers?.full_name || "—"} / {b.menu}
                  </div>
                  {b.sync_error_message && (
                    <div className="text-destructive/90 text-[11px] mt-0.5 truncate">⚠ {b.sync_error_message}</div>
                  )}
                </div>
                  <Button size="sm" className="rounded-none h-7 text-[11px] bg-destructive hover:bg-destructive/90" disabled={isExternalMirrorBooking(b)} onClick={() => resyncBooking(b)}>
                  <RefreshCw className="w-3 h-3 mr-1" /> 再同期
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" />
        </div>
      ) : bookings.length === 0 ? (
        <div className="py-24 text-center">
          <p className="eyebrow mb-3">— No Bookings Yet —</p>
          <p className="text-sm text-muted-foreground">配信を行うと、メールから予約が入ってきます</p>
        </div>
      ) : (
        <div className="space-y-16">
          {(sortMode === "received"
            ? [["__received__", flatByReceived] as const]
            : Object.entries(grouped) as ReadonlyArray<readonly [string, Booking[]]>
          ).map(([date, items]) => {
            const isReceivedMode = date === "__received__";
            const d = isReceivedMode ? null : new Date(date);
            return (
              <div key={date}>
                {isReceivedMode ? (
                  <div className="mb-6">
                    <div className="eyebrow text-[10px] text-muted-foreground">— Sorted by Received Time —</div>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-6 mb-6">
                    <div className="font-serif-en text-5xl text-gold/70 italic">
                      {String(d!.getDate()).padStart(2, "0")}
                    </div>
                    <div>
                      <div className="font-serif text-base">
                        {d!.toLocaleDateString("ja-JP", { year: "numeric", month: "long" })}
                      </div>
                      <div className="eyebrow text-[10px]">
                        {d!.toLocaleDateString("en-US", { weekday: "long" })}
                      </div>
                    </div>
                  </div>
                )}
                <div className="border-t border-border">
                  {items.map(b => {
                    const status = statusInfo(b.status);
                    const syncFailed = b.sync_status === "failed" || b.sync_status === "needs_review";
                    const lineMissing = b.source_channel === "line" && !b.external_reservation_id && b.status !== "cancelled" && b.status !== "completed";
                    const warnings = getExternalMirrorWarnings(b);
                    const danger = syncFailed || lineMissing || warnings.length > 0;
                    return (
                      <div key={b.id} className={`grid grid-cols-1 md:grid-cols-12 gap-4 py-6 border-b border-border/60 items-center transition-colors ${danger ? "bg-destructive/5 hover:bg-destructive/10 border-l-4 border-l-destructive pl-3" : "hover:bg-secondary/30"}`}>
                        {(danger || warnings.length > 0) && (
                          <div className="md:col-span-12 -mt-2 mb-1 flex items-start gap-2 text-[11px] text-destructive">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <div className="font-serif flex-1 space-y-1">
                              {warnings.map((warning) => <p key={warning}>{warning}</p>)}
                              {(syncFailed || lineMissing) && (
                                <p>
                                  {syncFailed ? `サロンボード同期${b.sync_status === "needs_review" ? "要確認" : "失敗"}` : "サロンボード未反映の可能性"}
                                  {b.sync_error_message ? `：${b.sync_error_message}` : ""}
                                </p>
                              )}
                            </div>
                            {(syncFailed || lineMissing) && (
                              <Button
                                size="sm"
                                className="ml-auto rounded-none h-6 text-[10px] bg-destructive hover:bg-destructive/90"
                                disabled={isExternalMirrorBooking(b)}
                                title={isExternalMirrorBooking(b) ? "外部予約はSalonBoostから再送できません" : undefined}
                                onClick={() => resyncBooking(b)}
                              >
                                <RefreshCw className="w-3 h-3 mr-1" /> サロンボードへ再同期
                              </Button>
                            )}
                          </div>
                        )}
                        <div className="md:col-span-2">
                          <div className="font-serif-en text-2xl">{b.booking_time.slice(0, 5)}</div>
                          {isReceivedMode && (
                            <div className="text-[10px] text-muted-foreground">{b.booking_date.replace(/-/g, "/").slice(5)}</div>
                          )}
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-serif mt-1 ${status.color}`}>
                            <span className="w-1 h-1 rounded-full bg-current" />
                            {status.label}
                          </span>
                        </div>
                        <div className="md:col-span-3">
                          <div className="font-serif text-sm flex items-center gap-2 flex-wrap">
                            {b.customers?.full_name || "—"}
                            {b.is_test && (
                              <span className="text-[9px] px-1.5 py-0.5 border border-destructive/40 text-destructive tracking-luxury">TEST</span>
                            )}
                            {sourceLabel(b.external_source) && (
                              <span className="text-[9px] px-1.5 py-0.5 border border-gold/40 text-gold tracking-luxury">{sourceLabel(b.external_source)}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{b.customers?.phone || ""}</div>
                          <div className="text-[10px] text-muted-foreground/70 mt-0.5">受信 {fmtReceived(b.created_at)}</div>
                        </div>
                        <div className="md:col-span-2 text-sm font-serif text-muted-foreground">
                          {b.menu}
                          <div className={b.total_duration_minutes == null ? "text-destructive text-[11px] mt-1" : "text-[11px] mt-1"}>
                            {b.total_duration_minutes == null ? "所要時間未取得" : `${b.total_duration_minutes}分`}
                          </div>
                          {b.notes && <div className="text-[11px] mt-1 italic">{b.notes}</div>}
                          {b.status === "completed" && (b.revenue ?? 0) > 0 && (
                            <div className="text-[11px] text-gold mt-1 font-serif-en">¥{(b.revenue ?? 0).toLocaleString()}</div>
                          )}
                          {b.campaign_id && <div className="text-[10px] mt-1 eyebrow text-gold">— from outreach</div>}
                        </div>
                        <div className="md:col-span-2">
                          {staff.length > 0 ? (
                            <Select
                              value={b.staff_id || "unassigned"}
                              disabled={isExternalMirrorBooking(b)}
                              onValueChange={(v) => assignStaff(b, v === "unassigned" ? null : v)}
                            >
                              <SelectTrigger className="rounded-none h-8 text-xs">
                                <SelectValue>
                                  {b.staff_id ? (
                                    <span className="flex items-center gap-2">
                                      <span className="w-2 h-2 rounded-full" style={{ background: staff.find(s => s.id === b.staff_id)?.display_color || "#999" }} />
                                      {staff.find(s => s.id === b.staff_id)?.name || "—"}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">未割当</span>
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">未割当</SelectItem>
                                {staff.map(s => (
                                  <SelectItem key={s.id} value={s.id}>
                                    <span className="flex items-center gap-2">
                                      <span className="w-2 h-2 rounded-full" style={{ background: s.display_color }} />
                                      {s.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </div>
                        <div className="md:col-span-3 flex flex-col md:items-end gap-2">
                          <Link
                            to={`/customers/${b.customer_id}/chart`}
                            className="inline-flex items-center gap-1.5 px-3 h-8 border border-gold/50 text-gold hover:bg-gold hover:text-background transition-colors text-xs tracking-luxury whitespace-nowrap"
                            title="カルテを開く"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            カルテを開く
                          </Link>
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {b.status === "pending" && (
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" disabled={isExternalMirrorBooking(b)} onClick={() => updateStatus(b, "confirmed")}>
                                確定
                              </Button>
                            )}
                            {(b.status === "pending" || b.status === "confirmed") && (
                              <>
                                <Button size="sm" variant="ghost" className="text-xs rounded-none h-8 w-8 p-0" title="お客様へ連絡" onClick={() => setMessageBooking(b)}>
                                  <MessageCircle className="w-3.5 h-3.5 stroke-[1.5]" />
                                </Button>
                                <Button size="sm" variant="ghost" className="text-xs rounded-none h-8 w-8 p-0" title="来店完了（売上を入力）" disabled={isExternalMirrorBooking(b)} onClick={() => handleComplete(b)}>
                                  <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.5]" />
                                </Button>
                                <Button size="sm" variant="ghost" className="text-xs rounded-none h-8 w-8 p-0" title={isExternalMirrorBooking(b) ? "外部予約はSalonBoostからキャンセルできません" : "キャンセル"} disabled={isExternalMirrorBooking(b)} onClick={() => updateStatus(b, "cancelled")}>
                                  <XCircle className="w-3.5 h-3.5 stroke-[1.5]" />
                                </Button>
                              </>
                            )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs rounded-none h-8 text-muted-foreground hover:text-destructive"
                                title={isExternalMirrorBooking(b) ? "外部予約はSalonBoostからアーカイブできません" : "予約をアーカイブ"}
                                disabled={isExternalMirrorBooking(b) || (b.status !== "cancelled" && b.status !== "completed")}
                              >
                                <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-none">
                              <AlertDialogHeader>
                                <AlertDialogTitle>この予約をアーカイブしますか？</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {b.customers?.full_name || "お客様"} 様 / {b.booking_date} {b.booking_time?.slice(0, 5)} / {b.menu}
                                  <br />予約データは監査のため保持し、通常の一覧から非表示にします。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="rounded-none">キャンセル</AlertDialogCancel>
                                <AlertDialogAction onClick={() => removeBooking(b)} className="rounded-none bg-destructive hover:bg-destructive/90">
                                  アーカイブする
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" className="rounded-none" disabled={loadingMore} onClick={() => void load(false, bookings.length)}>
                {loadingMore && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                さらに予約を表示
              </Button>
            </div>
          )}
        </div>
      )}

      <CustomerMessageDialog
        open={!!messageBooking}
        onClose={() => setMessageBooking(null)}
        customerId={messageBooking?.customer_id || ""}
        customerName={messageBooking?.customers?.full_name || ""}
        customerPhone={messageBooking?.customers?.phone}
        hasLine={!!messageBooking?.customers?.line_user_id}
        bookingTime={messageBooking?.booking_time?.slice(0, 5)}
      />
    </AppLayout>
  );
};

export default Bookings;
