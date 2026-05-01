import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface ReactivationStage {
  days: number;
  discount_percent: number;
  label: string;
}

const DEFAULT_STAGES: ReactivationStage[] = [
  { days: 30, discount_percent: 10, label: "お久しぶり" },
  { days: 60, discount_percent: 15, label: "そろそろ" },
  { days: 90, discount_percent: 20, label: "おかえりなさい" },
  { days: 150, discount_percent: 30, label: "特別ご招待" },
];

interface Props {
  value: ReactivationStage[];
  onChange: (stages: ReactivationStage[]) => void;
}

export default function ReactivationStagesEditor({ value, onChange }: Props) {
  const [stages, setStages] = useState<ReactivationStage[]>(value?.length ? value : DEFAULT_STAGES);

  useEffect(() => {
    if (value?.length) setStages(value);
  }, [value]);

  const update = (i: number, patch: Partial<ReactivationStage>) => {
    const next = stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setStages(next);
    onChange(next);
  };

  const remove = (i: number) => {
    if (stages.length <= 1) {
      toast.error("最低1段階は必要です");
      return;
    }
    const next = stages.filter((_, idx) => idx !== i);
    setStages(next);
    onChange(next);
  };

  const add = () => {
    if (stages.length >= 6) {
      toast.error("最大6段階までです");
      return;
    }
    const lastDays = stages[stages.length - 1]?.days || 90;
    const next = [...stages, { days: lastDays + 30, discount_percent: 20, label: "新しい段階" }];
    setStages(next);
    onChange(next);
  };

  const resetDefault = () => {
    setStages(DEFAULT_STAGES);
    onChange(DEFAULT_STAGES);
    toast.success("既定の4段階に戻しました");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="block font-serif text-sm">
            離脱客ステップ <span className="eyebrow text-[9px] text-muted-foreground ml-1">Win-Back Stages</span>
          </Label>
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            来店から指定日数が経過したお客様に、設定した割引率のクーポンを自動送信します。<br />
            各段階の<strong>±3日</strong>の窓でヒットした顧客が対象です。
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={resetDefault}
          className="rounded-none text-[10px] tracking-luxury text-muted-foreground hover:text-gold shrink-0">
          既定に戻す
        </Button>
      </div>

      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_1fr_2fr_auto] gap-2 items-center p-3 border border-border bg-secondary/10">
            <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50" />
            <div>
              <Label className="text-[9px] text-muted-foreground block mb-1">日数</Label>
              <div className="flex items-center gap-1">
                <Input type="number" min={1} max={730} value={s.days}
                  onChange={e => update(i, { days: Math.max(1, parseInt(e.target.value) || 0) })}
                  className="rounded-none h-8 text-xs px-2" />
                <span className="text-[10px] text-muted-foreground">日後</span>
              </div>
            </div>
            <div>
              <Label className="text-[9px] text-muted-foreground block mb-1">割引</Label>
              <div className="flex items-center gap-1">
                <Input type="number" min={0} max={100} value={s.discount_percent}
                  onChange={e => update(i, { discount_percent: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                  className="rounded-none h-8 text-xs px-2" />
                <span className="text-[10px] text-muted-foreground">%OFF</span>
              </div>
            </div>
            <div>
              <Label className="text-[9px] text-muted-foreground block mb-1">ラベル（メール件名等に使用）</Label>
              <Input value={s.label} onChange={e => update(i, { label: e.target.value.slice(0, 20) })}
                placeholder="お久しぶり"
                className="rounded-none h-8 text-xs px-2" />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}
              className="rounded-none text-destructive hover:bg-destructive/10 h-8 w-8 p-0">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" onClick={add} disabled={stages.length >= 6}
        className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5 w-full">
        <Plus className="w-3.5 h-3.5 mr-2" />
        段階を追加 <span className="ml-2 opacity-60 text-[10px]">ADD STAGE</span>
      </Button>

      <div className="p-3 border border-gold/20 bg-gold/5 text-[10px] text-muted-foreground leading-relaxed">
        <div className="flex items-center gap-2 text-gold mb-1">
          <Sparkles className="w-3 h-3" />
          <span className="font-serif text-foreground">プレビュー</span>
        </div>
        来店から{" "}
        {stages.map((s, i) => (
          <span key={i}>
            <strong className="text-foreground">{s.days}日後</strong>に
            <strong className="text-gold">{s.discount_percent > 0 ? `${s.discount_percent}%OFF` : "案内のみ"}</strong>
            {i < stages.length - 1 ? " → " : ""}
          </span>
        ))}
        の合計<strong className="text-foreground">{stages.length}段階</strong>で自動配信されます。
      </div>
    </div>
  );
}
