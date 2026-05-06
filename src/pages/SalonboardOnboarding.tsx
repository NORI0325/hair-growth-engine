import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { CheckCircle2, Circle, AlertTriangle } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  disconnected: "未接続",
  connected: "接続済み",
  mapping_incomplete: "マッピング未完了",
  test_pending: "テスト未完了",
  live: "本番同期ON",
  paused: "同期停止中",
  reauth_required: "要再認証",
};

export default function SalonboardOnboarding() {
  const { user } = useAuth();
  const { locationId } = useParams();
  const nav = useNavigate();
  const [ci, setCi] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [staffMap, setStaffMap] = useState<number>(0);
  const [menuMap, setMenuMap] = useState<number>(0);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [routeId, setRouteId] = useState("K000000001");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const locFilter = locationId && locationId !== "default" ? locationId : null;
    let ciq = supabase.from("channel_integrations").select("*")
      .eq("owner_id", user.id).eq("channel", "salonboard");
    ciq = locFilter ? ciq.eq("location_id", locFilter) : ciq.is("location_id", null);
    const { data: ciRow } = await ciq.maybeSingle();
    setCi(ciRow);
    if (ciRow?.default_rsv_route_id) setRouteId(ciRow.default_rsv_route_id);

    let sq = supabase.from("salonboard_sessions").select("login_status, last_login_at, last_error")
      .eq("owner_id", user.id);
    sq = locFilter ? sq.eq("location_id", locFilter) : sq.is("location_id", null);
    const { data: sRow } = await sq.maybeSingle();
    setSession(sRow);

    const { count: sc } = await supabase.from("staff_channel_mappings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id).eq("channel", "salonboard").eq("enabled", true);
    setStaffMap(sc ?? 0);
    const { count: mc } = await supabase.from("menu_channel_mappings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id).eq("channel", "salonboard").eq("enabled", true);
    setMenuMap(mc ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, locationId]);

  const saveCreds = async () => {
    if (!loginId || !password) { toast.error("ID/PWを入力してください"); return; }
    if (!confirm("このID/PWはSalonBoostではなく、サロンボード管理画面のログイン情報です。保存しますか？")) return;
    const res = await supabase.functions.invoke("salonboard-credentials-save", {
      body: {
        owner_id: user!.id,
        location_id: locationId === "default" ? null : locationId,
        login_id: loginId,
        password,
      },
    });
    if (res.error) toast.error("保存失敗: " + res.error.message);
    else { toast.success("認証情報を保存しました"); setLoginId(""); setPassword(""); load(); }
  };

  const saveRoute = async () => {
    const locFilter = locationId && locationId !== "default" ? locationId : null;
    let q = supabase.from("channel_integrations").update({ default_rsv_route_id: routeId })
      .eq("owner_id", user!.id).eq("channel", "salonboard");
    q = locFilter ? q.eq("location_id", locFilter) : q.is("location_id", null);
    const { error } = await q;
    if (error) toast.error(error.message); else toast.success("予約経路IDを保存しました");
  };

  const recompute = async () => {
    await supabase.rpc("recompute_channel_status", { _owner_id: user!.id, _location_id: locationId === "default" ? null : locationId });
    load();
  };

  const enableLive = async () => {
    if (!confirm("本番同期をONにしますか？以後、新規予約が自動的にサロンボードへ送信されます。")) return;
    const locFilter = locationId && locationId !== "default" ? locationId : null;
    let q = supabase.from("channel_integrations")
      .update({ sync_enabled: true, connection_status: "live", live_enabled_at: new Date().toISOString() })
      .eq("owner_id", user!.id).eq("channel", "salonboard");
    q = locFilter ? q.eq("location_id", locFilter) : q.is("location_id", null);
    const { error } = await q;
    if (error) toast.error(error.message);
    else { toast.success("本番同期をONにしました"); load(); }
  };

  const sessionOk = session && ["ok", "active", "success"].includes(session.login_status);
  const testOk = ci?.test_create_passed_at && ci?.test_update_passed_at && ci?.test_cancel_passed_at;
  const canGoLive = sessionOk && staffMap > 0 && menuMap > 0 && testOk && ci?.connection_status !== "live";

  const Step = ({ done, n, title, children }: any) => (
    <Card className="rounded-none p-5">
      <div className="flex items-start gap-3">
        <div className="mt-1">{done ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Circle className="w-5 h-5 text-muted-foreground" />}</div>
        <div className="flex-1">
          <div className="text-[10px] tracking-luxury text-gold mb-1">STEP {n}</div>
          <h3 className="font-serif text-lg mb-3">{title}</h3>
          {children}
        </div>
      </div>
    </Card>
  );

  if (loading) return <div className="container py-12 text-center text-muted-foreground">読み込み中...</div>;

  return (
    <div className="container max-w-4xl py-12 px-6">
      <div className="mb-8">
        <div className="text-[10px] tracking-luxury text-gold mb-2">SALONBOARD ONBOARDING</div>
        <h1 className="font-serif text-3xl mb-2">サロンボード連携セットアップ</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">現在のステータス:</span>
          <Badge className="rounded-none">{STATUS_LABEL[ci?.connection_status ?? "disconnected"]}</Badge>
          <Button variant="ghost" size="sm" className="rounded-none" onClick={recompute}>再判定</Button>
        </div>
      </div>

      <div className="space-y-4">
        <Step done={!!ci?.last_login_at || sessionOk} n={1} title="サロンボード認証情報の登録">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><Label>ログインID</Label><Input value={loginId} onChange={(e) => setLoginId(e.target.value)} className="rounded-none" /></div>
            <div><Label>パスワード</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-none" /></div>
          </div>
          <Button size="sm" onClick={saveCreds} className="rounded-none">保存</Button>
          {sessionOk && <div className="text-xs text-emerald-700 mt-2">セッション有効（最終ログイン: {session?.last_login_at ? new Date(session.last_login_at).toLocaleString("ja-JP") : "-"}）</div>}
          {session?.last_error && <div className="text-xs text-red-600 mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{session.last_error}</div>}
        </Step>

        <Step done={staffMap > 0} n={2} title={`スタッフ連携（${staffMap}名 マッピング済み）`}>
          <p className="text-sm text-muted-foreground mb-3">サロンボードからスタッフ一覧を自動取得し、一括取り込みできます。</p>
          <div className="flex gap-2">
            <Button size="sm" className="rounded-none" onClick={() => nav(`/onboarding/salonboard/${locationId || "default"}/auto-mapping`)}>サロンボードから自動取得</Button>
            <Button size="sm" variant="outline" className="rounded-none" onClick={() => nav("/staff")}>スタッフ画面へ</Button>
          </div>
        </Step>

        <Step done={menuMap > 0} n={3} title={`メニュー連携（${menuMap}件 マッピング済み）`}>
          <p className="text-sm text-muted-foreground mb-3">サロンボードからメニュー一覧を自動取得し、一括取り込みできます。</p>
          <div className="flex gap-2">
            <Button size="sm" className="rounded-none" onClick={() => nav(`/onboarding/salonboard/${locationId || "default"}/auto-mapping`)}>サロンボードから自動取得</Button>
            <Button size="sm" variant="outline" className="rounded-none" onClick={() => nav("/menu-items")}>メニュー画面へ</Button>
          </div>
        </Step>

        <Step done={!!ci?.default_rsv_route_id} n={4} title="予約経路ID（rsvRouteId）">
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label>rsvRouteId</Label><Input value={routeId} onChange={(e) => setRouteId(e.target.value)} className="rounded-none" /></div>
            <Button size="sm" onClick={saveRoute} className="rounded-none">保存</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">既定値 K000000001 = 電話(自社)</p>
        </Step>

        <Step done={!!testOk} n={5} title="テスト同期（create / update / cancel）">
          <div className="text-xs space-y-1">
            <div>create テスト: {ci?.test_create_passed_at ? <span className="text-emerald-700">✓ 合格</span> : <span className="text-muted-foreground">未実施</span>}</div>
            <div>update テスト: {ci?.test_update_passed_at ? <span className="text-emerald-700">✓ 合格</span> : <span className="text-muted-foreground">未実施</span>}</div>
            <div>cancel テスト: {ci?.test_cancel_passed_at ? <span className="text-emerald-700">✓ 合格</span> : <span className="text-muted-foreground">未実施</span>}</div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">予約管理画面からテスト顧客で create→update→cancel を実行してください。各成功時に自動でフラグが更新されます。</p>
        </Step>

        <Step done={ci?.connection_status === "live"} n={6} title="本番同期ON">
          <p className="text-sm text-muted-foreground mb-3">全ステップが完了している場合のみONにできます。</p>
          <Button onClick={enableLive} disabled={!canGoLive} className="rounded-none">
            {ci?.connection_status === "live" ? "本番同期ON中" : "本番同期をONにする"}
          </Button>
        </Step>
      </div>
    </div>
  );
}
