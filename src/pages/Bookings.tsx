import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2, CheckCircle2, XCircle } from "lucide-react";
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
    if (error) {
      toast.error("更新に失敗しました");
      return;
    }
    toast.success("ステータスを更新しました");
    load();
  };

  const statusBadge = (s: string) => {
    if (s === "confirmed") return <Badge variant="default">確定</Badge>;
    if (s === "completed") return <Badge variant="secondary">来店済</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">キャンセル</Badge>;
    return <Badge variant="outline">予約中</Badge>;
  };

  // 日付ごとにグループ化
  const grouped = bookings.reduce((acc, b) => {
    if (!acc[b.booking_date]) acc[b.booking_date] = [];
    acc[b.booking_date].push(b);
    return acc;
  }, {} as Record<string, Booking[]>);

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">予約管理</h1>
        <p className="text-muted-foreground">{bookings.length}件の予約があります</p>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        </div>
      ) : bookings.length === 0 ? (
        <Card className="p-12 text-center shadow-soft">
          <Calendar className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-bold mb-2">まだ予約がありません</h3>
          <p className="text-sm text-muted-foreground">
            キャンペーンを配信すると、メールから予約が入ってきます
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <h2 className="font-bold text-lg mb-3 sticky top-0 bg-background py-2">
                {new Date(date).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
              </h2>
              <div className="space-y-2">
                {items.map(b => (
                  <Card key={b.id} className="shadow-soft">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-4">
                          <div className="text-2xl font-bold text-primary">
                            {b.booking_time.slice(0, 5)}
                          </div>
                          <div>
                            <div className="font-semibold">{b.customers?.full_name || "不明"}</div>
                            <div className="text-sm text-muted-foreground">
                              {b.menu} {b.customers?.phone && `/ ${b.customers.phone}`}
                            </div>
                            {b.notes && <div className="text-xs text-muted-foreground mt-1">{b.notes}</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusBadge(b.status)}
                          {b.status === "pending" && (
                            <Button size="sm" onClick={() => updateStatus(b.id, "confirmed")}>確定</Button>
                          )}
                          {(b.status === "pending" || b.status === "confirmed") && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => updateStatus(b.id, "completed")}>
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />来店済
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => updateStatus(b.id, "cancelled")}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
};

export default Bookings;
