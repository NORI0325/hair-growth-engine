import { useNavigate, useSearchParams } from "react-router-dom";
import { useSubscription, trialDaysRemaining } from "@/hooks/useSubscription";
import { useTenantId } from "@/hooks/useTenant";
import { useLocations } from "@/hooks/useLocations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, Store } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";

const BASE_PRICE = 9800;
const ADDITIONAL_LOCATION_PRICE = 7800;

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  trialing: { label: "無料トライアル中", color: "bg-blue-100 text-blue-700" },
  active: { label: "有料プラン", color: "bg-green-100 text-green-700" },
  past_due: { label: "支払い遅延", color: "bg-amber-100 text-amber-700" },
  canceled: { label: "解約済み", color: "bg-gray-100 text-gray-700" },
  paused: { label: "一時停止中", color: "bg-gray-100 text-gray-700" },
  locked: { label: "ロック中", color: "bg-red-100 text-red-700" },
};

const Billing = () => {
  const { data: sub, isLoading, refetch } = useSubscription();
  const tenantId = useTenantId();
  const [params] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const reason = params.get("reason");

  const startCheckout = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { tenant_id: tenantId } });
    setLoading(false);
    if (error || !data?.url) { toast.error("Checkoutセッションの作成に失敗しました"); return; }
    window.location.href = data.url;
  };

  const openPortal = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("create-portal-session");
    setLoading(false);
    if (error || !data?.url) { toast.error("ポータルへのリダイレクトに失敗しました"); return; }
    window.location.href = data.url;
  };

  const days = trialDaysRemaining(sub);
  const status = STATUS_LABELS[sub?.status ?? "trialing"];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">契約・お支払い</h1>
          <p className="text-muted-foreground">月額¥9,800のシンプルな1プランでご利用いただけます。</p>
        </div>

        {reason === "inactive" && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-900">この機能を使うには有効なご契約が必要です</p>
                <p className="text-amber-800 mt-1">下記から月額プランを開始してください。</p>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-6 space-y-4">
          {isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">現在の契約状態</h2>
                <Badge className={status.color}>{status.label}</Badge>
              </div>
              {sub?.status === "trialing" && days !== null && (
                <p className="text-sm text-muted-foreground">トライアル残り <span className="font-bold text-foreground">{days}日</span>（{new Date(sub.trial_ends_at!).toLocaleDateString("ja-JP")}まで）</p>
              )}
              {sub?.current_period_end && sub.status === "active" && (
                <p className="text-sm text-muted-foreground">次回更新日: {new Date(sub.current_period_end).toLocaleDateString("ja-JP")}</p>
              )}
            </>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <div>
            <p className="eyebrow text-xs mb-2">— Standard Plan —</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">¥9,800</span>
              <span className="text-muted-foreground">/月（税込）</span>
            </div>
          </div>
          <ul className="space-y-2 text-sm">
            {["顧客・予約・メッセージ無制限", "LINE / メール / SMS 配信", "AIアシスタント", "スタッフ無制限", "全機能利用可能"].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />{f}
              </li>
            ))}
          </ul>
          {sub?.stripe_subscription_id ? (
            <Button className="w-full" onClick={openPortal} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}お支払い情報・解約の管理
            </Button>
          ) : (
            <Button className="w-full" onClick={startCheckout} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}クレジットカードを登録する
            </Button>
          )}
          <p className="text-xs text-muted-foreground text-center">登録は任意です。トライアル終了後に自動課金されます。</p>
        </Card>

        <Button variant="ghost" onClick={() => navigate("/dashboard")}>← ダッシュボードへ戻る</Button>
      </div>
    </AppLayout>
  );
};

export default Billing;
