import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

interface Booking {
  id: string;
  booking_date: string;
  booking_time: string;
  menu: string;
  notes: string | null;
  status: string;
  customers: { full_name: string; phone: string | null } | null;
}

const statusInfo = (s: string) => {
  if (s === "confirmed") return { label: "Confirmed", color: "text-gold" };
  if (s === "completed") return { label: "Visited", color: "text-success" };
  if (s === "cancelled") return { label: "Cancelled", color: "text-destructive" };
  return { label: "Pending", color: "text-muted-foreground" };
};

const Bookings = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("bookings")
      .select("id, booking_date, booking_time, menu, notes, status, customers(full_name, phone)")
      .order("booking_date", { ascending: true })
      .order("booking_time", { ascending: true });
    if (data) setBookings(data as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: "completed" | "cancelled" | "confirmed") => {
    const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
    if (error) { toast.error("更新に失敗しました"); return; }
    toast.success("ステータスを更新しました");
    load();
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
                      <div key={b.id} className="grid grid-cols-12 gap-6 py-6 border-b border-border/60 items-center hover:bg-secondary/30 transition-colors">
                        <div className="col-span-2">
                          <div className="font-serif-en text-2xl">{b.booking_time.slice(0, 5)}</div>
                        </div>
                        <div className="col-span-4">
                          <div className="font-serif text-sm">{b.customers?.full_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{b.customers?.phone || ""}</div>
                        </div>
                        <div className="col-span-3 text-sm font-serif text-muted-foreground">
                          {b.menu}
                          {b.notes && <div className="text-[11px] mt-1 italic">{b.notes}</div>}
                        </div>
                        <div className="col-span-1">
                          <span className={`inline-flex items-center gap-2 text-[10px] tracking-luxury ${status.color}`}>
                            <span className="w-1 h-1 rounded-full bg-current" />
                            {status.label.toUpperCase()}
                          </span>
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-1">
                          {b.status === "pending" && (
                            <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" onClick={() => updateStatus(b.id, "confirmed")}>
                              確定
                            </Button>
                          )}
                          {(b.status === "pending" || b.status === "confirmed") && (
                            <>
                              <Button size="sm" variant="ghost" className="text-xs rounded-none h-8" onClick={() => updateStatus(b.id, "completed")}>
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
