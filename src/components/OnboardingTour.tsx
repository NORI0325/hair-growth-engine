import { useEffect, useState } from "react";
import { Joyride, STATUS, type CallBackProps, type Step } from "react-joyride";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// 初回ログインツアー（ダッシュボード以降で発火）
const OnboardingTour = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [run, setRun] = useState(false);

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
        // 少し待ってからツアー開始
        setTimeout(() => setRun(true), 800);
      }
    })();
  }, [user]);

  const steps: Step[] = [
    {
      target: "body",
      placement: "center",
      content: (
        <div className="space-y-2 text-left">
          <h3 className="font-serif text-lg">ようこそ Salon Boost へ</h3>
          <p className="text-sm">主要機能を1分でご案内します。いつでもスキップできます。</p>
        </div>
      ),
      disableBeacon: true,
    },
    {
      target: "[data-tour='nav-daily']",
      content: (
        <div className="space-y-2 text-left">
          <h3 className="font-serif">毎日使う機能</h3>
          <p className="text-sm">予約・顧客・受信トレイ・カレンダーは常時表示。最も使う機能です。</p>
        </div>
      ),
    },
    {
      target: "[data-tour='nav-groups']",
      content: (
        <div className="space-y-2 text-left">
          <h3 className="font-serif">業務別メニュー</h3>
          <p className="text-sm">集客・店舗運営・分析・設定はカテゴリ別。クリックで展開します。</p>
        </div>
      ),
    },
    {
      target: "[data-tour='help-widget']",
      content: (
        <div className="space-y-2 text-left">
          <h3 className="font-serif">困ったらここ</h3>
          <p className="text-sm">右下の✨ボタンで、AIサポート・マニュアル・人への問い合わせができます。</p>
        </div>
      ),
      placement: "left",
    },
  ];

  const handleCallback = async (data: CallBackProps) => {
    const { status } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      if (user) {
        await supabase.from("profiles").update({ tour_completed: true }).eq("id", user.id);
      }
    }
  };

  if (!run) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showSkipButton
      showProgress
      callback={handleCallback}
      locale={{ back: "戻る", close: "閉じる", last: "完了", next: "次へ", skip: "スキップ" }}
      styles={{
        options: {
          primaryColor: "hsl(36, 33%, 57%)",
          textColor: "hsl(0, 0%, 12%)",
          backgroundColor: "hsl(0, 0%, 100%)",
          arrowColor: "hsl(0, 0%, 100%)",
          overlayColor: "rgba(0, 0, 0, 0.5)",
          zIndex: 10000,
        },
        tooltip: { borderRadius: 8, padding: 16 },
        buttonNext: { fontSize: 13, padding: "8px 16px" },
        buttonBack: { fontSize: 13 },
        buttonSkip: { fontSize: 12 },
      }}
    />
  );
};

export default OnboardingTour;
