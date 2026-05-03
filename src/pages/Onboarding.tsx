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
import { Loader2, ArrowRight, Check, Copy, ExternalLink, MessageCircle, Mail, LayoutDashboard, HelpCircle } from "lucide-react";

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
  const [lineMode, setLineMode] = useState<"choose" | "connect" | "create" | "skip">("choose");
  const [lineCreds, setLineCreds] = useState({ access_token: "", channel_secret: "" });
  const [publicSlug, setPublicSlug] = useState("");
  const [inboundKey, setInboundKey] = useState("");
  const WEBHOOK_URL = "https://miyedioemkzhetphjzzg.supabase.co/functions/v1/line-webhook";

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("salon_name, open_time, close_time, onboarding_progress, public_slug, inbound_key").eq("id", user.id).maybeSingle();
      if (data) {
        setSalon({
          salon_name: data.salon_name ?? "",
          open_time: (data.open_time as string)?.slice(0, 5) ?? "10:00",
          close_time: (data.close_time as string)?.slice(0, 5) ?? "19:00",
        });
        setPublicSlug((data as any).public_slug ?? "");
        setInboundKey((data as any).inbound_key ?? "");
        const p = (data.onboarding_progress as OnboardingProgress) || {};
        setProgress(p);
        if (p.done) navigate("/dashboard");
      }
    })();
  }, [user, navigate]);

  const copyText = async (text: string, label = "コピーしました") => {
    try { await navigator.clipboard.writeText(text); toast.success(label); }
    catch { toast.error("コピーに失敗しました"); }
  };

  const saveLineCreds = async () => {
    if (!user) return;
    if (!lineCreds.access_token.trim() || !lineCreds.channel_secret.trim()) {
      toast.error("チャネルアクセストークンとチャネルシークレットを入力してください"); return;
    }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      line_channel_access_token: lineCreds.access_token.trim(),
      line_channel_secret: lineCreds.channel_secret.trim(),
    }).eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("LINEを接続しました");
    await updateProgress({ line: true });
    setStep(5);
  };


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
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">メニュー登録</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  最低3つ登録してください。後から「メニュー」画面で追加・編集できます。
                </p>
              </div>

              {/* ヘッダー */}
              <div className="grid grid-cols-12 gap-3 px-1 text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
                <div className="col-span-6">メニュー名</div>
                <div className="col-span-2 text-right">所要時間</div>
                <div className="col-span-3 text-right">料金</div>
                <div className="col-span-1"></div>
              </div>

              <div className="space-y-3">
                {menus.map((m, i) => (
                  <div key={i} className="grid grid-cols-12 gap-3 items-center">
                    <Input
                      className="col-span-6"
                      placeholder="例：カット"
                      value={m.name}
                      onChange={(e) => { const c = [...menus]; c[i].name = e.target.value; setMenus(c); }}
                    />
                    <div className="col-span-2 relative">
                      <Input
                        type="number" min={5} step={5}
                        value={m.duration}
                        onChange={(e) => { const c = [...menus]; c[i].duration = Number(e.target.value); setMenus(c); }}
                        className="pr-8 text-right"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">分</span>
                    </div>
                    <div className="col-span-3 relative">
                      <Input
                        type="number" min={0} step={100}
                        value={m.price}
                        onChange={(e) => { const c = [...menus]; c[i].price = Number(e.target.value); setMenus(c); }}
                        className="pr-8 text-right"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">円</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMenu(i)}
                      disabled={menus.length <= 1}
                      className="col-span-1 h-9 flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="削除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <Button variant="outline" className="w-full" onClick={() => setMenus([...menus, { name: "", duration: 60, price: 5000 }])}>
                + メニューを追加
              </Button>

              <div className="pt-2 border-t border-border">
                <Button className="w-full" size="lg" onClick={saveMenus} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  保存して次へ <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
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
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold">LINE公式アカウント連携（任意）</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  予約確認・リマインド・再来促進をLINEで自動配信できるようになります。
                </p>
              </div>

              {lineMode === "choose" && (
                <div className="grid gap-3">
                  <button
                    onClick={() => setLineMode("connect")}
                    className="text-left border border-border hover:border-primary/60 hover:bg-secondary/30 transition p-4 rounded-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                        <MessageCircle className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">① LINE公式アカウントを持っている</div>
                        <div className="text-xs text-muted-foreground mt-0.5">2つの値を貼り付けるだけで接続完了（約1分）</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setLineMode("create")}
                    className="text-left border border-border hover:border-primary/60 hover:bg-secondary/30 transition p-4 rounded-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                        <HelpCircle className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">② これから作る／よく分からない</div>
                        <div className="text-xs text-muted-foreground mt-0.5">5分でわかるガイドを表示します</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={async () => { await updateProgress({ line: true }); setStep(5); }}
                    className="text-left border border-dashed border-border hover:border-foreground/30 transition p-4 rounded-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <ArrowRight className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">③ 今はスキップ</div>
                        <div className="text-xs text-muted-foreground mt-0.5">後から「設定 &gt; LINE連携」でいつでも設定できます</div>
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {lineMode === "connect" && (
                <div className="space-y-4">
                  <div className="bg-secondary/30 border border-border p-3 rounded-md text-xs space-y-1">
                    <div className="font-semibold">取得方法</div>
                    <div className="text-muted-foreground">LINE Developers → 該当チャネル → 「Messaging API設定」内の<br/>・チャネルアクセストークン（長期）<br/>・「チャネル基本設定」内の<strong>チャネルシークレット</strong></div>
                  </div>
                  <div>
                    <Label>チャネルアクセストークン</Label>
                    <Input value={lineCreds.access_token} onChange={(e) => setLineCreds({ ...lineCreds, access_token: e.target.value })} placeholder="xxxxxxxxxxxxxxxxxxxx..." />
                  </div>
                  <div>
                    <Label>チャネルシークレット</Label>
                    <Input value={lineCreds.channel_secret} onChange={(e) => setLineCreds({ ...lineCreds, channel_secret: e.target.value })} placeholder="xxxxxxxxxxxxxxxxxxxx" />
                  </div>
                  <div>
                    <Label>Webhook URL（LINE側に貼り付け）</Label>
                    <div className="flex gap-2">
                      <Input value={WEBHOOK_URL} readOnly className="font-mono text-xs" />
                      <Button type="button" variant="outline" onClick={() => copyText(WEBHOOK_URL)}><Copy className="w-4 h-4" /></Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">LINE Developers → Messaging API設定 → Webhook URL に貼り付けて「検証」→「Webhookの利用」をON。</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setLineMode("choose")}>戻る</Button>
                    <Button className="flex-1" onClick={saveLineCreds} disabled={saving}>
                      {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}接続して次へ
                    </Button>
                  </div>
                </div>
              )}

              {lineMode === "create" && (
                <div className="space-y-4 text-sm">
                  <div className="bg-secondary/30 border border-border p-4 rounded-md space-y-2">
                    <div className="font-semibold">5分でできる：LINE公式アカウントの作成手順</div>
                    <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground text-xs leading-relaxed">
                      <li><a className="text-primary underline" href="https://www.linebiz.com/jp/entry/" target="_blank" rel="noopener noreferrer">LINE for Business</a> でアカウントを作成（無料）</li>
                      <li>LINE Official Account Manager にログイン → 「設定」→「Messaging API」を有効化</li>
                      <li>表示された「プロバイダー」を作成 → LINE Developersコンソールが開きます</li>
                      <li>「Messaging API設定」から<strong>チャネルアクセストークン</strong>を発行</li>
                      <li>「チャネル基本設定」から<strong>チャネルシークレット</strong>をコピー</li>
                      <li>戻ってきて「① 持っている」に2つを貼り付けて完了</li>
                    </ol>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setLineMode("choose")}>戻る</Button>
                    <Button className="flex-1" onClick={() => setLineMode("connect")}>取得できた → 接続する</Button>
                  </div>
                  <button onClick={async () => { await updateProgress({ line: true }); setStep(5); }} className="text-xs text-muted-foreground hover:text-foreground underline w-full text-center">
                    今はスキップして後で設定する
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Check className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold">準備完了！</h2>
                <p className="text-sm text-muted-foreground">
                  60日間の無料トライアルがスタートしました。<br />
                  「最初の予約」を最短で取るための3つの一手 👇
                </p>
              </div>

              {/* Action 1: 公開予約URL */}
              <div className="border border-border rounded-md p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center text-gold font-semibold text-sm shrink-0">1</div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">公開予約URLをSNS・名刺・LINEへ</div>
                    <div className="text-xs text-muted-foreground mt-0.5">このURLを配るだけで、新規のお客様がいつでも予約できます。</div>
                  </div>
                </div>
                {publicSlug ? (
                  <div className="flex gap-2">
                    <Input readOnly value={`${window.location.origin}/salon/${publicSlug}`} className="text-xs font-mono" />
                    <Button variant="outline" size="sm" onClick={() => copyText(`${window.location.origin}/salon/${publicSlug}`, "予約URLをコピーしました")}>
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/salon/${publicSlug}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a>
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">URLは「共有」ページで確認できます。</p>
                )}
              </div>

              {/* Action 2: ホットペッパー転送 */}
              <div className="border border-border rounded-md p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center text-gold font-semibold text-sm shrink-0">2</div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">ホットペッパー / サロンボードの予約を自動取込</div>
                    <div className="text-xs text-muted-foreground mt-0.5">下の専用アドレスに転送するだけ。AIが自動で予約・顧客を登録します。</div>
                  </div>
                </div>
                {inboundKey ? (
                  <div className="flex gap-2">
                    <Input readOnly value={`hp-${inboundKey}@inbound.saronboost.com`} className="text-xs font-mono" />
                    <Button variant="outline" size="sm" onClick={() => copyText(`hp-${inboundKey}@inbound.saronboost.com`, "転送アドレスをコピーしました")}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">「設定 &gt; 予約取込メール」から取得できます。</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  💡 Gmailで「ホットペッパー予約通知」を上のアドレスに転送するルールを作るだけ。DNSやResendの設定は不要です。
                </p>
              </div>

              {/* Action 3: ダッシュボード */}
              <div className="border border-border rounded-md p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center text-gold font-semibold text-sm shrink-0">3</div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">ダッシュボードで全体像を確認</div>
                    <div className="text-xs text-muted-foreground mt-0.5">本日の予約・売上・離脱リスクが一目で分かります。</div>
                  </div>
                </div>
              </div>

              <Button className="w-full" size="lg" onClick={finish}>
                <LayoutDashboard className="w-4 h-4 mr-2" />ダッシュボードを開く
              </Button>
              <p className="text-[11px] text-center text-muted-foreground">
                右下の✨ボタンから、いつでもAIサポート・マニュアルにアクセスできます。
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Onboarding;
