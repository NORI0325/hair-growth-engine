import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, MessageCircle, Trash2, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerMessageDialog } from "@/components/CustomerMessageDialog";
import { useCurrentLocationId } from "@/hooks/useLocations";

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
  const [messageBooking, setMessageBooking] = useState<Booking | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("schedule");

  const load = async () => {
    if (!user || !locationId) { setBookings([]); setStaff([]); setLoading(false); return; }
    setLoading(true);
    const [b, s] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, customer_id, booking_date, booking_time, menu, notes, status, revenue, campaign_id, is_test, staff_id, created_at, external_source, customers(full_name, phone, line_user_id)")
        .eq("location_id", locationId)
        .order("booking_date", { ascending: true })
        .order("booking_time", { ascending: true }),
      supabase.from("staff").select("id, name, display_color").eq("location_id", locationId).eq("active", true).order("sort_order"),
    ]);
    if (b.data) setBookings(b.data as any);
    setStaff((s.data as Staff[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, locationId]);

  const assignStaff = async (id: string, staffId: string | null) => {
    const { error } = await supabase.from("bookings").update({ staff_id: staffId }).eq("id", id);
    if (error) { toast.error("担当変更に失敗: " + error.message); return; }
    toast.success("担当スタッフを更新しました");
    load();
  };

  const updateStatus = async (id: string, status: "completed" | "cancelled" | "confirmed", revenue?: number) => {
    const update: any = { status };
    if (revenue != null) update.revenue = revenue;
    const { data, error } = await supabase.from("bookings").update(update).eq("id", id).select();
    if (error) {
      console.error("[bookings.update] error:", error);
      toast.error("更新に失敗しました：" + (error.message || "不明なエラー"));
      return;
    }
    if (!data || data.length === 0) {
      console.warn("[bookings.update] 0 rows updated. Possible RLS or auth issue. id=", id);
      toast.error("更新できませんでした。再ログイン後にお試しください。");
      return;
    }
    toast.success("ステータスを更新しました");
    if (status === "cancelled") {
      supabase.functions.invoke("notify-owner-booking", {
        body: { bookingId: id, eventType: "cancelled" },
      }).catch(() => {});
    }
    load();
  };

  const handleComplete = (b: Booking) => {
    const input = window.prompt(`${b.customers?.full_name || "お客様"}様の売上金額を入力してください（¥）`, "0");
    if (input === null) return;
    const amount = parseInt(input.replace(/[^\d]/g, ""), 10);
    if (isNaN(amount) || amount < 0) { toast.error("正しい金額を入力してください"); return; }
    updateStatus(b.id, "completed", amount);
  };

  const removeBooking = async (id: string) => {
    const { error } = await supabase.from("bookings").delete().eq("id", id);
    if (error) { toast.error("削除に失敗しました：" + error.message); return; }
    toast.success("予約を削除しました");
    setBookings((prev) => prev.filter((b) => b.id !== id));
  };

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

      <div className="flex justify-end mb-6">
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
                    return (
                      <div key={b.id} className="grid grid-cols-12 gap-4 py-6 border-b border-border/60 items-center hover:bg-secondary/30 transition-colors">
                        <div className="col-span-2">
                          <div className="font-serif-en text-2xl">{b.booking_time.slice(0, 5)}</div>
                          {isReceivedMode && (
                            <div className="text-[10px] text-muted-foreground">{b.booking_date.replace(/-/g, "/").slice(5)}</div>
                          )}
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-serif mt-1 ${status.color}`}>
                            <span className="w-1 h-1 rounded-full bg-current" />
                            {status.label}
                          </span>
                        </div>
                        <div className="col-span-3">
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
                        <div className="col-span-2 text-sm font-serif text-muted-foreground">
                          {b.menu}
                          {b.notes && <div className="text-[11px] mt-1 italic">{b.notes}</div>}
                          {b.status === "completed" && (b.revenue ?? 0) > 0 && (
                            <div className="text-[11px] text-gold mt-1 font-serif-en">¥{(b.revenue ?? 0).toLocaleString()}</div>
                          )}
                          {b.campaign_id && <div className="text-[10px] mt-1 eyebrow text-gold">— from outreach</div>}
                        </div>
                        <div className="col-span-2">
                          {staff.length > 0 ? (
                            <Select
                              value={b.staff_id || "unassigned"}
                              onValueChange={(v) => assignStaff(b.id, v === "unassigned" ? null : v)}
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
                        <div className="col-span-2 flex items-center justify-end gap-1">
                          {b.status === "pending" && (
                            <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" onClick={() => updateStatus(b.id, "confirmed")}>
                              確定
                            </Button>
                          )}
                          {(b.status === "pending" || b.status === "confirmed") && (
                            <>
                              <Link
                                to={`/customers/${b.customer_id}/chart`}
                                className="inline-flex items-center gap-1 px-2 h-8 border border-gold/40 text-gold hover:bg-gold hover:text-background transition-colors text-[10px] tracking-luxury"
                                title="カルテを開く"
                              >
                                <FileText className="w-3 h-3" />
                                カルテ
                              </Link>
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" title="お客様へ連絡" onClick={() => setMessageBooking(b)}>
                                <MessageCircle className="w-3.5 h-3.5 stroke-[1.5]" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" title="来店完了（売上を入力）" onClick={() => handleComplete(b)}>
                                <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.5]" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" onClick={() => updateStatus(b.id, "cancelled")}>
                                <XCircle className="w-3.5 h-3.5 stroke-[1.5]" />
                              </Button>
                            </>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8 text-muted-foreground hover:text-destructive" title="予約を削除">
                                <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-none">
                              <AlertDialogHeader>
                                <AlertDialogTitle>この予約を削除しますか？</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {b.customers?.full_name || "お客様"} 様 / {b.booking_date} {b.booking_time?.slice(0, 5)} / {b.menu}
                                  <br />予約データを完全に削除します。この操作は取り消せません。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="rounded-none">キャンセル</AlertDialogCancel>
                                <AlertDialogAction onClick={() => removeBooking(b.id)} className="rounded-none bg-destructive hover:bg-destructive/90">
                                  削除する
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
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
