import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RefreshCw, AlertTriangle, TrendingUp, Calendar, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Insights {
  summary: string;
  recommendations: string[];
  risks: string[];
  next_visit_suggestion: string;
  preferred_tone: string;
  generated_at: string;
  cached?: boolean;
}

const TONE_LABEL: Record<string, string> = {
  polite: "丁寧・フォーマル",
  friendly: "親しみ・カジュアル",
  luxury: "上質・ラグジュアリー",
  casual: "気さく・フランク",
};

// AIレスポンスを安全な形に正規化（欠損フィールドでクラッシュしないように）
const normalize = (raw: any): Insights => ({
  summary: typeof raw?.summary === "string" ? raw.summary : "（要約はまだありません）",
  recommendations: Array.isArray(raw?.recommendations) ? raw.recommendations.filter((x: any) => typeof x === "string") : [],
  risks: Array.isArray(raw?.risks) ? raw.risks.filter((x: any) => typeof x === "string") : [],
  next_visit_suggestion: typeof raw?.next_visit_suggestion === "string" ? raw.next_visit_suggestion : "—",
  preferred_tone: typeof raw?.preferred_tone === "string" ? raw.preferred_tone : "polite",
  generated_at: typeof raw?.generated_at === "string" ? raw.generated_at : new Date().toISOString(),
  cached: !!raw?.cached,
});

const safeFormatDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return format(d, "MM/dd HH:mm");
  } catch {
    return "—";
  }
};

export const CustomerInsightsPanel = ({ customerId }: { customerId: string }) => {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  const generate = async (force = false) => {
    setLoading(true);
    setErrored(false);
    try {
      const { data: res, error } = await supabase.functions.invoke("ai-customer-insights", {
        body: { customer_id: customerId, force },
      });
      if (error || (res as any)?.error) {
        const msg = (res as any)?.message || (res as any)?.error || error?.message || "AI分析に失敗しました";
        toast.error(msg);
        setErrored(true);
        return;
      }
      setData(normalize(res));
      if (force) toast.success("最新の分析を生成しました");
    } catch (e: any) {
      console.error("[CustomerInsightsPanel] generate failed", e);
      toast.error("AI分析でエラーが発生しました");
      setErrored(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (customerId) generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (!data && loading) {
    return (
      <div className="border border-gold/30 bg-gradient-to-br from-secondary/20 to-transparent p-8 text-center">
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-gold mb-3" />
        <p className="text-xs text-muted-foreground">AIが履歴を分析中…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="border border-gold/30 bg-gradient-to-br from-secondary/20 to-transparent p-6 text-center space-y-2">
        <Sparkles className="w-6 h-6 mx-auto text-gold mb-1" />
        <Button onClick={() => generate(false)} variant="outline" className="rounded-none border-gold/40">
          {errored ? "AIインサイトを再試行" : "AIインサイトを生成"}
        </Button>
        {errored && (
          <p className="text-[10px] text-muted-foreground">分析に失敗しました。時間をおいて再度お試しください。</p>
        )}
      </div>
    );
  }

  return (
    <div className="border border-gold/30 bg-gradient-to-br from-secondary/20 to-transparent p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="eyebrow text-[10px] flex items-center gap-1.5 text-gold">
          <Sparkles className="w-3 h-3" />— AI Concierge Insights —
        </div>
        <Button
          size="sm" variant="ghost" onClick={() => generate(true)} disabled={loading}
          className="rounded-none text-[10px] h-7"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RefreshCw className="w-3 h-3 mr-1" />再分析</>}
        </Button>
      </div>

      <div className="text-sm font-serif italic text-foreground/90 border-l-2 border-gold pl-3">
        💭 {data.summary}
      </div>

      {data.recommendations.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-gold" />推奨アクション
          </div>
          <ul className="space-y-1.5">
            {data.recommendations.map((r, i) => (
              <li key={i} className="text-xs flex items-start gap-2">
                <span className="text-gold mt-0.5">▸</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.risks.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-700 mb-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />注意事項
          </div>
          <ul className="space-y-1">
            {data.risks.map((r, i) => (
              <li key={i} className="text-xs text-foreground/80">• {r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="w-3 h-3" />次回ご来店
          </div>
          <div className="text-xs font-serif">{data.next_visit_suggestion}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1">
            <MessageCircle className="w-3 h-3" />最適トーン
          </div>
          <div className="text-xs font-serif">{TONE_LABEL[data.preferred_tone] || data.preferred_tone}</div>
        </div>
      </div>

      <div className="text-[9px] text-muted-foreground text-right">
        {data.cached ? "キャッシュ" : "新規生成"} · {safeFormatDate(data.generated_at)}
      </div>
    </div>
  );
};
