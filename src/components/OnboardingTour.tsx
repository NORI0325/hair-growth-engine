import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";

// シンプルな初回ツアー（react-joyride v3 のSSR/型問題を避けるため自前実装）
type TourStep = { title: string; body: string; action?: { label: string; href?: string } };

const STEPS: TourStep[] = [
  {
    title: "ようこそ Salon Boost へ",
    body: "60日間の無料トライアルがスタートしました。主要機能を1分でご案内します。",
  },
  {
    title: "毎日使う機能",
    body: "左上の「Daily」セクション（ダッシュボード・受信トレイ・予約カレンダー・予約一覧・顧客）が日々の業務の中心です。",
  },
  {
    title: "業務別メニュー",
    body: "集客・販促 / 店舗運営 / 分析 / 設定 はカテゴリ別に整理されています。クリックで展開・折りたたみできます。",
  },
  {
    title: "予約取込メールが便利です",
    body: "ホットペッパー等から届く予約メールを転送設定するだけで、AIが自動で予約・顧客を登録します。設定 > 予約取込メールアドレス から始められます。",
    action: { label: "設定を開く", href: "/settings" },
  },
  {
    title: "困ったらいつでも",
    body: "右下の✨ボタンから AIサポート・マニュアル・人への問い合わせができます。各ページのヘッダーの「？このページの使い方」も活用してください。",
    action: { label: "ヘルプを開く", href: "/help" },
  },
];

const OnboardingTour = () => {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("tour_completed, onboarding_progress")
        .eq("id", user.id)
        .maybeSingle();
      const onboardingDone = (data?.onboarding_progress as any)?.done === true;
      if (data && !data.tour_completed && onboardingDone) {
        setTimeout(() => setShow(true), 600);
      }
    })();
  }, [user]);

  const finish = async () => {
    setShow(false);
    if (user) {
      await supabase.from("profiles").update({ tour_completed: true }).eq("id", user.id);
    }
  };

  if (!show) return null;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card border border-border rounded-lg max-w-md w-full p-8 shadow-2xl relative">
        <button
          onClick={finish}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
          aria-label="閉じる"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-gold" />
          <p className="eyebrow text-[10px] text-gold">— Tour {step + 1} / {STEPS.length} —</p>
        </div>

        <h2 className="font-serif text-2xl mb-3">{current.title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">{current.body}</p>

        {/* progress dots */}
        <div className="flex gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-gold" : "bg-border"}`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button onClick={finish} className="text-xs text-muted-foreground hover:text-foreground">
            スキップ
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={() => setStep(step - 1)}>
                戻る
              </Button>
            )}
            {current.action && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (current.action?.href) {
                    finish();
                    window.location.href = current.action.href;
                  }
                }}
              >
                {current.action.label}
              </Button>
            )}
            {!isLast ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                次へ
              </Button>
            ) : (
              <Button size="sm" onClick={finish}>
                完了
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTour;
