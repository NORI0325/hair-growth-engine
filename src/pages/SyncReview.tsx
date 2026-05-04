import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, CheckCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const CHANNEL_LABEL: Record<string, string> = {
  salonboard: "サロンボード",
  rakuten_beauty: "楽天ビューティー",
  line_reservation: "LINE予約",
  google_reservation: "Google予約",
  own_web: "自社Web",
  phone: "電話予約",
};

const ERROR_LABEL: Record<string, string> = {
  captcha_required: "画像認証が表示",
  login_failed: "ログイン失敗",
  session_expired: "セッション切れ",
  mapping_not_found: "マッピング未設定",
  duplicate_risk: "重複予約の可能性",
  external_site_changed: "外部画面変更を検知",
  network_error: "ネットワークエラー",
  unknown_error: "不明なエラー",
};

export default function SyncReview() {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("sync_jobs")
      .select(`
        id, target_channel, job_type, status, retry_count, error_type, error_message, created_at, updated_at, reservation_id,
        bookings:reservation_id ( id, booking_date, booking_time, menu, customer_id, staff_id, sync_status,
          customers:customer_id ( full_name ),
          staff:staff_id ( name )
        )
      `)
      .eq("owner_id", user.id)
      .in("status", ["failed", "needs_review"])
      .order("updated_at", { ascending: false })
      .limit(100);
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const retry = async (jobId: string) => {
    const res = await supabase.functions.invoke("sync-job-retry", { body: { sync_job_id: jobId } });
    if (res.error) toast.error("再同期失敗: " + res.error.message);
    else toast.success("再同期しました");
    load();
  };

  const markResolved = async (jobId: string, reservationId: string | null) => {
    await supabase.from("sync_jobs").update({ status: "cancelled", error_message: "管理者により確認済み" }).eq("id", jobId);
    if (reservationId) {
      await supabase.from("bookings").update({ needs_manual_review: false, sync_status: "not_required" }).eq("id", reservationId);
    }
    toast.success("確認済みにしました");
    load();
  };

  return (
    <div className="container max-w-6xl py-12 px-6">
      <div className="mb-10">
        <div className="text-[10px] tracking-luxury text-gold mb-2">SYNC REVIEW</div>
        <h1 className="font-serif text-3xl mb-2">要確認キュー</h1>
        <p className="text-sm text-muted-foreground">外部媒体への同期に失敗した予約や、画像認証・マッピング未設定などで自動処理を停止した予約の一覧です。</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">読み込み中...</div>
      ) : items.length === 0 ? (
        <Card className="rounded-none p-12 text-center text-muted-foreground">
          <CheckCheck className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
          要確認の予約はありません
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((it) => {
            const b = it.bookings;
            return (
              <Card key={it.id} className="rounded-none border-l-4 border-l-red-500 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="rounded-none bg-secondary text-foreground border">{CHANNEL_LABEL[it.target_channel] ?? it.target_channel}</Badge>
                      <Badge className="rounded-none bg-red-50 text-red-700 border-red-200">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {ERROR_LABEL[it.error_type] ?? it.error_type ?? "エラー"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">再試行 {it.retry_count}/3</span>
                    </div>
                    {b && (
                      <div className="text-sm">
                        <span className="font-serif">{b.customers?.full_name ?? "顧客不明"}</span>
                        <span className="text-muted-foreground"> ・ {b.booking_date} {b.booking_time?.slice(0,5)} ・ {b.menu}</span>
                        {b.staff?.name && <span className="text-muted-foreground"> ・ 担当: {b.staff.name}</span>}
                      </div>
                    )}
                    {it.error_message && <div className="text-xs text-red-600 bg-red-50 px-2 py-1">{it.error_message}</div>}
                    <div className="text-[10px] text-muted-foreground">最終更新: {new Date(it.updated_at).toLocaleString("ja-JP")}</div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm" className="rounded-none" disabled={it.retry_count >= 3} onClick={() => retry(it.id)}>
                      <RefreshCw className="w-3 h-3 mr-1" />手動再同期
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-none" onClick={() => markResolved(it.id, it.reservation_id)}>
                      <CheckCheck className="w-3 h-3 mr-1" />確認済みに
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
