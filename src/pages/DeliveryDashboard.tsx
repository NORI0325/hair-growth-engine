import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Loader2, TrendingUp, AlertCircle, Clock, Send, ShieldOff, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";

interface Stat {
  label: string;
  value: number;
  sub?: string;
  icon: any;
  tone?: "default" | "warn" | "good" | "bad";
}

interface UpcomingRow {
  id: string;
  job_type: string;
  scheduled_for: string;
  approval_status: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  opt_out_automation: boolean | null;
}

const TYPE_LABEL: Record<string, string> = {
  reactivation: "復活クーポン", birthday: "お誕生日", thank_you: "サンクス",
  aftercare: "アフターケア", next_suggestion: "次回ご提案", review_request: "レビュー依頼",
  vip_upgrade: "VIP昇格", anniversary: "記念日", referral_thanks: "紹介感謝",
  holiday_notice: "休業のお知らせ", welcome: "ようこそ", reminder: "予約リマインド",
};

export default function DeliveryDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [last7Sent, setLast7Sent] = useState(0);
  const [last7Failed, setLast7Failed] = useState(0);
  const [optOutCount, setOptOutCount] = useState(0);
  const [quietCount, setQuietCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [upcRes, pendRes, sentRes, failRes, optRes, quietRes] = await Promise.all([
        supabase.from("delivery_upcoming_view" as any)
          .select("*").eq("owner_id", user.id)
          .order("scheduled_for", { ascending: true }).limit(20),
        supabase.from("scheduled_jobs")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", user.id).eq("status", "pending")
          .eq("approval_status", "pending_approval"),
        supabase.from("email_send_log")
          .select("message_id", { count: "exact", head: true })
          .eq("status", "sent").gte("created_at", sevenDaysAgo),
        supabase.from("email_send_log")
          .select("message_id", { count: "exact", head: true })
          .in("status", ["dlq", "failed", "bounced"]).gte("created_at", sevenDaysAgo),
        supabase.from("customers")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", user.id).eq("opt_out_automation", true),
        supabase.from("customers")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", user.id).gt("quiet_until", new Date().toISOString()),
      ]);

      setUpcoming((upcRes.data as any) || []);
      setPendingApprovals(pendRes.count || 0);
      setLast7Sent(sentRes.count || 0);
      setLast7Failed(failRes.count || 0);
      setOptOutCount(optRes.count || 0);
      setQuietCount(quietRes.count || 0);
      setLoading(false);
    })();
  }, [user]);

  const stats: Stat[] = [
    { label: "承認待ち", value: pendingApprovals, sub: "Approvals", icon: Clock, tone: pendingApprovals > 0 ? "warn" : "default" },
    { label: "直近7日 配信", value: last7Sent, sub: "Sent / 7d", icon: Send, tone: "good" },
    { label: "直近7日 失敗", value: last7Failed, sub: "Failed / 7d", icon: AlertCircle, tone: last7Failed > 0 ? "bad" : "default" },
    { label: "配信停止中", value: optOutCount, sub: "Opted out", icon: ShieldOff },
    { label: "サイレント中", value: quietCount, sub: "Quiet period", icon: CheckCircle2 },
    { label: "今後の配信予定", value: upcoming.length, sub: "Upcoming", icon: TrendingUp },
  ];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.05 — Delivery Operations"
        title="配信ダッシュボード"
        description="今日・今週、誰に・何を・どれだけお届けするか。一画面で。"
      />

      {loading ? (
        <div className="text-center py-20"><Loader2 className="w-4 h-4 mx-auto animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border mb-10 border border-border">
            {stats.map((s) => {
              const Icon = s.icon;
              const tone =
                s.tone === "warn" ? "text-amber-600" :
                s.tone === "bad" ? "text-destructive" :
                s.tone === "good" ? "text-gold" : "text-foreground";
              return (
                <div key={s.label} className="bg-background p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="eyebrow text-[9px] text-muted-foreground">{s.sub}</p>
                    <Icon className={`w-3.5 h-3.5 ${tone}`} />
                  </div>
                  <p className={`font-serif-en text-3xl ${tone}`}>{s.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{s.label}</p>
                </div>
              );
            })}
          </div>

          {pendingApprovals > 0 && (
            <Link to="/approvals" className="block mb-8 border border-amber-600/40 bg-amber-600/5 p-4 hover:bg-amber-600/10 transition-colors">
              <p className="text-sm font-serif">
                <Clock className="w-3.5 h-3.5 inline-block mr-2 text-amber-600" />
                承認待ちが <span className="text-amber-600 text-lg">{pendingApprovals}</span> 件あります → 確認する
              </p>
            </Link>
          )}

          <div className="mb-4 flex items-center justify-between">
            <p className="eyebrow">— 今後の配信予定 / Upcoming —</p>
            <Link to="/schedule" className="text-xs text-muted-foreground gold-underline">すべて見る</Link>
          </div>

          {upcoming.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border">
              <p className="text-sm text-muted-foreground">直近の配信予定はありません</p>
            </div>
          ) : (
            <div className="border-t border-border">
              {upcoming.map((u) => (
                <div key={u.id} className="py-4 border-b border-border/60 flex items-center gap-4 text-sm">
                  <div className="w-32 text-xs text-muted-foreground font-mono">
                    {new Date(u.scheduled_for).toLocaleString("ja-JP", {
                      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-serif">{u.customer_name || "—"}</span>
                    <span className="ml-3 text-[10px] text-muted-foreground">
                      {TYPE_LABEL[u.job_type] || u.job_type}
                    </span>
                    {u.opt_out_automation && (
                      <span className="ml-2 text-[10px] text-destructive">配信停止中</span>
                    )}
                  </div>
                  {u.approval_status === "pending_approval" && (
                    <span className="text-[10px] text-amber-600">承認待ち</span>
                  )}
                  {u.approval_status === "approved" && (
                    <span className="text-[10px] text-gold">承認済</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
