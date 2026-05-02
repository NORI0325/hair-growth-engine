import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, X, Loader2, Clock } from "lucide-react";
import { Link } from "react-router-dom";

interface PendingJob {
  id: string;
  customer_id: string;
  job_type: string;
  scheduled_for: string;
  payload: any;
  customers?: { full_name: string; email: string | null; phone: string | null } | null;
}

const TYPE_LABEL: Record<string, string> = {
  reactivation: "復活クーポン",
  birthday: "お誕生日メッセージ",
  thank_you: "サンクス",
  aftercare: "アフターケア",
  next_suggestion: "次回ご提案",
  review_request: "レビュー依頼",
  vip_upgrade: "VIPランクアップ",
  anniversary: "記念日",
  referral_thanks: "紹介感謝",
  holiday_notice: "休業のお知らせ",
};

const SEGMENT_LABEL: Record<string, { label: string; tone: string }> = {
  cold_1:     { label: "ワンショット離脱",   tone: "bg-muted text-muted-foreground" },
  warm_mid:   { label: "軽度離脱(2-3回)",    tone: "bg-blue-500/10 text-blue-700" },
  loyal_risk: { label: "元常連の離脱予備軍", tone: "bg-amber-500/10 text-amber-700" },
  lost_1:     { label: "ワンショット休眠",   tone: "bg-muted text-muted-foreground" },
  churned:    { label: "離脱(2-3回)",        tone: "bg-orange-500/10 text-orange-700" },
  vip_lost:   { label: "⚠ VIP離脱(手動推奨)", tone: "bg-destructive/10 text-destructive font-bold" },
};

export default function Approvals() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<PendingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("scheduled_jobs")
      .select("id, customer_id, job_type, scheduled_for, payload, customers:customer_id(full_name, email, phone)")
      .eq("status", "pending")
      .eq("approval_status", "pending_approval")
      .order("scheduled_for", { ascending: true })
      .limit(200);
    if (error) toast.error(error.message);
    setJobs((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    const patch: any = action === "approve"
      ? { approval_status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id }
      : { approval_status: "rejected", status: "cancelled", rejected_reason: "owner_rejected" };
    const { error } = await supabase.from("scheduled_jobs").update(patch).eq("id", id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(action === "approve" ? "承認しました" : "却下しました");
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const approveAll = async () => {
    if (jobs.length === 0) return;
    if (!confirm(`${jobs.length}件すべてを承認します。よろしいですか？`)) return;
    setBusyId("__all__");
    const ids = jobs.map(j => j.id);
    const { error } = await supabase.from("scheduled_jobs")
      .update({ approval_status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id })
      .in("id", ids);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length}件を承認しました`);
    setJobs([]);
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.04 — Approvals"
        title="配信の事前承認"
        description="お客様にお届けする前に、内容を一通だけご確認ください。"
      />

      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-muted-foreground">
          承認待ち <span className="text-foreground font-serif text-lg">{jobs.length}</span> 件
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>更新</Button>
          {jobs.length > 0 && (
            <Button size="sm" onClick={approveAll} disabled={busyId === "__all__"}>
              {busyId === "__all__" ? <Loader2 className="w-3 h-3 mr-1 animate-spin"/> : <Check className="w-3 h-3 mr-1" />}
              すべて承認
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground"><Loader2 className="w-4 h-4 mx-auto animate-spin"/></div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border">
          <Clock className="w-6 h-6 mx-auto mb-3 text-muted-foreground"/>
          <p className="font-serif text-sm">承認待ちの配信はありません</p>
          <p className="text-xs text-muted-foreground mt-2">
            完全自動モードに切り替えるには <Link to="/settings" className="text-gold gold-underline">設定</Link> へ
          </p>
        </div>
      ) : (
        <div className="border-t border-border">
          {jobs.map(j => (
            <div key={j.id} className="py-5 border-b border-border/60 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-serif text-sm">{j.customers?.full_name || "—"}</span>
                  <Badge variant="secondary" className="text-[10px]">{TYPE_LABEL[j.job_type] || j.job_type}</Badge>
                  {j.payload?.discount_percent && (
                    <span className="text-[10px] text-gold">{j.payload.discount_percent}% OFF</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {j.customers?.email || j.customers?.phone || "連絡先なし"} · 予定 {new Date(j.scheduled_for).toLocaleString("ja-JP")}
                  {j.payload?.label && <> · {j.payload.label}</>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => decide(j.id, "reject")} disabled={busyId === j.id}>
                  <X className="w-3 h-3"/>
                </Button>
                <Button size="sm" onClick={() => decide(j.id, "approve")} disabled={busyId === j.id}>
                  {busyId === j.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <Check className="w-3 h-3 mr-1"/>}
                  承認
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
