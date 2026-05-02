import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, ArrowRight, Check } from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5;

interface OnboardingProgress {
  salon_info?: boolean;
  menus?: boolean;
  staff?: boolean;
  line?: boolean;
  done?: boolean;
}

const Onboarding = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [salon, setSalon] = useState({ salon_name: "", open_time: "10:00", close_time: "19:00" });
  const [menus, setMenus] = useState<{ name: string; duration: number; price: number }[]>([
    { name: "カット", duration: 60, price: 5500 },
    { name: "カラー", duration: 90, price: 8800 },
    { name: "カット＋カラー", duration: 150, price: 13200 },
  ]);
  const [staffName, setStaffName] = useState("");
  const [progress, setProgress] = useState<OnboardingProgress>({});

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("salon_name, open_time, close_time, onboarding_progress").eq("id", user.id).maybeSingle();
      if (data) {
        setSalon({
          salon_name: data.salon_name ?? "",
          open_time: (data.open_time as string)?.slice(0, 5) ?? "10:00",
          close_time: (data.close_time as string)?.slice(0, 5) ?? "19:00",
        });
        const p = (data.onboarding_progress as OnboardingProgress) || {};
        setProgress(p);
        if (p.done) navigate("/dashboard");
      }
    })();
  }, [user, navigate]);

  const updateProgress = async (next: OnboardingProgress) => {
    if (!user) return;
    const merged = { ...progress, ...next };
    setProgress(merged);
    await supabase.from("profiles").update({ onboarding_progress: merged }).eq("id", user.id);
  };

  const saveSalon = async () => {
    if (!user) return;
    if (!salon.salon_name.trim()) { toast.error("サロン名を入力してください"); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      salon_name: salon.salon_name,
      open_time: salon.open_time, close_time: salon.close_time,
    }).eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    await updateProgress({ salon_info: true });
    setStep(2);
  };

  const saveMenus = async () => {
    if (!user) return;
    const valid = menus.filter((m) => m.name.trim() && m.duration > 0);
    if (valid.length < 3) { toast.error("最低3つのメニューを登録してください"); return; }
    setSaving(true);
    // ユーザー作成時の既定店舗を取得
    const { data: loc } = await supabase.from("locations").select("id").eq("tenant_id", user.id).order("is_primary", { ascending: false }).limit(1).maybeSingle();
    const locId = loc?.id;
    const { error } = await supabase.from("menu_items").insert(
      valid.map((m, i) => ({
        owner_id: user.id, location_id: locId, name: m.name, duration_minutes: m.duration, price: m.price, sort_order: i, active: true,
      })),
    );
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    await updateProgress({ menus: true });
    setStep(3);
  };

  const removeMenu = (i: number) => {
    if (menus.length <= 1) return;
    setMenus(menus.filter((_, idx) => idx !== i));
  };

  const saveStaff = async () => {
    if (!user) return;
    if (!staffName.trim()) { toast.error("スタッフ名を入力してください"); return; }
    setSaving(true);
    const { data: loc } = await supabase.from("locations").select("id").eq("tenant_id", user.id).order("is_primary", { ascending: false }).limit(1).maybeSingle();
    const locId = loc?.id;
    const { error } = await supabase.from("staff").insert({
      owner_id: user.id, location_id: locId, name: staffName, active: true, bookable: true, sort_order: 0,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    await updateProgress({ staff: true });
    setStep(4);
  };

  const skipLine = async () => { await updateProgress({ line: true }); setStep(5); };

  const finish = async () => {
    await updateProgress({ done: true });
    toast.success("初期設定が完了しました");
    navigate("/dashboard");
  };

  const progressPct = (step / 5) * 100;

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <p className="eyebrow mb-2">— Setup —</p>
          <h1 className="display text-3xl mb-4">サロンの初期設定</h1>
          <Progress value={progressPct} className="h-2" />
          <p className="text-sm text-muted-foreground mt-2">ステップ {step} / 5</p>
        </div>

        <Card className="p-8">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">基本情報</h2>
              <div><Label>サロン名 *</Label><Input value={salon.salon_name} onChange={(e) => setSalon({ ...salon, salon_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>開店時刻</Label><Input type="time" value={salon.open_time} onChange={(e) => setSalon({ ...salon, open_time: e.target.value })} /></div>
                <div><Label>閉店時刻</Label><Input type="time" value={salon.close_time} onChange={(e) => setSalon({ ...salon, close_time: e.target.value })} /></div>
              </div>
              <Button className="w-full" onClick={saveSalon} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}次へ <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">メニュー登録（最低3つ）</h2>
              {menus.map((m, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input className="col-span-6" placeholder="メニュー名" value={m.name} onChange={(e) => { const c = [...menus]; c[i].name = e.target.value; setMenus(c); }} />
                  <Input className="col-span-3" type="number" placeholder="分" value={m.duration} onChange={(e) => { const c = [...menus]; c[i].duration = Number(e.target.value); setMenus(c); }} />
                  <Input className="col-span-3" type="number" placeholder="円" value={m.price} onChange={(e) => { const c = [...menus]; c[i].price = Number(e.target.value); setMenus(c); }} />
                </div>
              ))}
              <Button variant="outline" className="w-full" onClick={() => setMenus([...menus, { name: "", duration: 60, price: 5000 }])}>+ 追加</Button>
              <Button className="w-full" onClick={saveMenus} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}次へ <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">スタッフ登録</h2>
              <p className="text-sm text-muted-foreground">最初のスタッフ（オーナー本人でも可）を登録します。後から追加可能。</p>
              <div><Label>スタッフ名</Label><Input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="例: 山田太郎" /></div>
              <Button className="w-full" onClick={saveStaff} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}次へ <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">LINE連携（任意）</h2>
              <p className="text-sm text-muted-foreground">LINE公式アカウントとの連携は後からいつでも設定できます。今はスキップして問題ありません。</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={skipLine}>後で設定する</Button>
                <Button className="flex-1" onClick={() => { navigate("/settings"); }}>設定画面へ</Button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold">準備完了！</h2>
              <p className="text-sm text-muted-foreground">
                60日間の無料トライアルが始まりました。<br />
                公開予約URLは「共有」ページから取得できます。
              </p>
              <Button className="w-full" onClick={finish}>ダッシュボードへ</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Onboarding;
