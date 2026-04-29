import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  customers: { full_name: string; phone: string | null } | null;
}

interface Staff { id: string; name: string; display_color: string; }

const statusInfo = (s: string) => {
  if (s === "confirmed") return { label: "確定", color: "text-gold" };
  if (s === "completed") return { label: "来店済", color: "text-success" };
  if (s === "cancelled") return { label: "キャンセル", color: "text-destructive" };
  return { label: "未確定", color: "text-muted-foreground" };
};

const Bookings = () => {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [b, s] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_date, booking_time, menu, notes, status, revenue, campaign_id, is_test, staff_id, customers(full_name, phone)")
        .order("booking_date", { ascending: true })
        .order("booking_time", { ascending: true }),
      user ? supabase.from("staff").select("id, name, display_color").eq("owner_id", user.id).eq("active", true).order("sort_order") : Promise.resolve({ data: [] }),
    ]);
    if (b.data) setBookings(b.data as any);
    setStaff((s.data as Staff[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

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

  const grouped = bookings.reduce((acc, b) => {
    if (!acc[b.booking_date]) acc[b.booking_date] = [];
    acc[b.booking_date].push(b);
    return acc;
  }, {} as Record<string, Booking[]>);

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.05 — Bookings"
        title="予約"
        description={`${bookings.length} 件の再会が予定されています`}
      />

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
          {Object.entries(grouped).map(([date, items]) => {
            const d = new Date(date);
            return (
              <div key={date}>
                <div className="flex items-baseline gap-6 mb-6">
                  <div className="font-serif-en text-5xl text-gold/70 italic">
                    {String(d.getDate()).padStart(2, "0")}
                  </div>
                  <div>
                    <div className="font-serif text-base">
                      {d.toLocaleDateString("ja-JP", { year: "numeric", month: "long" })}
                    </div>
                    <div className="eyebrow text-[10px]">
                      {d.toLocaleDateString("en-US", { weekday: "long" })}
                    </div>
                  </div>
                </div>
                <div className="border-t border-border">
                  {items.map(b => {
                    const status = statusInfo(b.status);
                    return (
                      <div key={b.id} className="grid grid-cols-12 gap-4 py-6 border-b border-border/60 items-center hover:bg-secondary/30 transition-colors">
                        <div className="col-span-2">
                          <div className="font-serif-en text-2xl">{b.booking_time.slice(0, 5)}</div>
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-serif mt-1 ${status.color}`}>
                            <span className="w-1 h-1 rounded-full bg-current" />
                            {status.label}
                          </span>
                        </div>
                        <div className="col-span-3">
                          <div className="font-serif text-sm flex items-center gap-2">
                            {b.customers?.full_name || "—"}
                            {b.is_test && (
                              <span className="text-[9px] px-1.5 py-0.5 border border-destructive/40 text-destructive tracking-luxury">TEST</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{b.customers?.phone || ""}</div>
                        </div>
                        <div className="col-span-3 text-sm font-serif text-muted-foreground">
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
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" title="来店完了（売上を入力）" onClick={() => handleComplete(b)}>
                                <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.5]" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" onClick={() => updateStatus(b.id, "cancelled")}>
                                <XCircle className="w-3.5 h-3.5 stroke-[1.5]" />
                              </Button>
                            </>
                          )}
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
    </AppLayout>
  );
};

export default Bookings;
