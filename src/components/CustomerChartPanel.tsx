import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";

interface Chart {
  id?: string;
  customer_id: string;
  hair_type: string | null;
  hair_thickness: string | null;
  hair_density: string | null;
  damage_level: number | null;
  scalp_condition: string | null;
  allergies: string | null;
  has_diamine_allergy: boolean;
  is_pregnant: boolean;
  pregnancy_due_date: string | null;
  medical_notes: string | null;
  preferred_style: string | null;
  ng_keywords: string | null;
  preferred_talk_level: number | null;
  preferred_scent: string | null;
  internal_notes: string | null;
}

const empty = (customerId: string): Chart => ({
  customer_id: customerId,
  hair_type: null, hair_thickness: null, hair_density: null,
  damage_level: null, scalp_condition: null,
  allergies: null, has_diamine_allergy: false,
  is_pregnant: false, pregnancy_due_date: null, medical_notes: null,
  preferred_style: null, ng_keywords: null,
  preferred_talk_level: null, preferred_scent: null, internal_notes: null,
});

export const CustomerChartPanel = ({ customerId }: { customerId: string }) => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const [chart, setChart] = useState<Chart>(empty(customerId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("customer_charts")
        .select("*")
        .eq("customer_id", customerId)
        .maybeSingle();
      if (data) setChart(data as Chart);
      else setChart(empty(customerId));
      setLoading(false);
    })();
  }, [customerId]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const payload: any = {
      ...chart,
      owner_id: user.id,
      location_id: locationId,
    };
    const { error } = await supabase
      .from("customer_charts")
      .upsert(payload, { onConflict: "customer_id" });
    setSaving(false);
    if (error) { toast.error("保存失敗: " + error.message); return; }
    toast.success("カルテを保存しました");
  };

  if (loading) return <div className="py-8 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>;

  const hasAlert = chart.has_diamine_allergy || chart.is_pregnant || (chart.allergies && chart.allergies.trim());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gold" />
          <h3 className="font-serif text-base">電子カルテ <span className="eyebrow text-[10px] text-muted-foreground ml-2">Medical Chart</span></h3>
        </div>
        <Button onClick={save} disabled={saving} size="sm" className="rounded-none">
          {saving ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Save className="w-3 h-3 mr-2" />}
          保存
        </Button>
      </div>

      {hasAlert && (
        <div className="border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-serif text-destructive">⚠️ 重要アラート</div>
            {chart.has_diamine_allergy && <div>・ジアミンアレルギーあり（カラー要注意・パッチテスト必須）</div>}
            {chart.is_pregnant && <div>・妊娠中{chart.pregnancy_due_date && `（予定日: ${chart.pregnancy_due_date}）`}</div>}
            {chart.allergies && <div>・アレルギー: {chart.allergies}</div>}
          </div>
        </div>
      )}

      {/* 髪質 */}
      <div>
        <p className="eyebrow text-[10px] mb-3">— Hair Profile —</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-[11px]">髪質</Label>
            <Select value={chart.hair_type || ""} onValueChange={(v) => setChart({ ...chart, hair_type: v || null })}>
              <SelectTrigger className="rounded-none h-9 text-xs"><SelectValue placeholder="選択" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="straight">直毛</SelectItem>
                <SelectItem value="wave">ウェーブ</SelectItem>
                <SelectItem value="curl">カール</SelectItem>
                <SelectItem value="strong_curl">強いクセ</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">髪の太さ</Label>
            <Select value={chart.hair_thickness || ""} onValueChange={(v) => setChart({ ...chart, hair_thickness: v || null })}>
              <SelectTrigger className="rounded-none h-9 text-xs"><SelectValue placeholder="選択" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thin">細い</SelectItem>
                <SelectItem value="medium">普通</SelectItem>
                <SelectItem value="thick">太い</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">毛量</Label>
            <Select value={chart.hair_density || ""} onValueChange={(v) => setChart({ ...chart, hair_density: v || null })}>
              <SelectTrigger className="rounded-none h-9 text-xs"><SelectValue placeholder="選択" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">少ない</SelectItem>
                <SelectItem value="medium">普通</SelectItem>
                <SelectItem value="high">多い</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">ダメージ (0-5)</Label>
            <Input type="number" min={0} max={5} value={chart.damage_level ?? ""}
              onChange={(e) => setChart({ ...chart, damage_level: e.target.value ? Number(e.target.value) : null })}
              className="rounded-none h-9 text-xs" />
          </div>
          <div className="col-span-2">
            <Label className="text-[11px]">頭皮状態</Label>
            <Select value={chart.scalp_condition || ""} onValueChange={(v) => setChart({ ...chart, scalp_condition: v || null })}>
              <SelectTrigger className="rounded-none h-9 text-xs"><SelectValue placeholder="選択" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="healthy">健康</SelectItem>
                <SelectItem value="dry">乾燥</SelectItem>
                <SelectItem value="oily">脂性</SelectItem>
                <SelectItem value="sensitive">敏感</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* アレルギー・医療 */}
      <div>
        <p className="eyebrow text-[10px] mb-3 text-destructive">— Medical & Allergy —</p>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={chart.has_diamine_allergy}
              onCheckedChange={(v) => setChart({ ...chart, has_diamine_allergy: v })} />
            <Label className="text-xs">ジアミンアレルギー（カラー薬剤）</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={chart.is_pregnant}
              onCheckedChange={(v) => setChart({ ...chart, is_pregnant: v })} />
            <Label className="text-xs">妊娠中</Label>
          </div>
          {chart.is_pregnant && (
            <div>
              <Label className="text-[11px]">出産予定日</Label>
              <Input type="date" value={chart.pregnancy_due_date || ""}
                onChange={(e) => setChart({ ...chart, pregnancy_due_date: e.target.value || null })}
                className="rounded-none h-9 text-xs" />
            </div>
          )}
          <div>
            <Label className="text-[11px]">その他アレルギー・医療メモ</Label>
            <Textarea value={chart.allergies || ""}
              onChange={(e) => setChart({ ...chart, allergies: e.target.value || null })}
              placeholder="例: 金属アレルギー、薬剤かぶれの既往"
              className="rounded-none text-xs min-h-[60px]" />
          </div>
        </div>
      </div>

      {/* 好み */}
      <div>
        <p className="eyebrow text-[10px] mb-3">— Preferences —</p>
        <div className="space-y-3">
          <div>
            <Label className="text-[11px]">好みのスタイル</Label>
            <Input value={chart.preferred_style || ""}
              onChange={(e) => setChart({ ...chart, preferred_style: e.target.value || null })}
              placeholder="例: 透明感のあるベージュ、肩につく長さキープ"
              className="rounded-none h-9 text-xs" />
          </div>
          <div>
            <Label className="text-[11px]">NGワード（絶対やってはいけないこと）</Label>
            <Input value={chart.ng_keywords || ""}
              onChange={(e) => setChart({ ...chart, ng_keywords: e.target.value || null })}
              placeholder="例: 前髪は絶対切らない、明るすぎる色NG"
              className="rounded-none h-9 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px]">トーク好み度</Label>
              <Select value={chart.preferred_talk_level?.toString() || ""}
                onValueChange={(v) => setChart({ ...chart, preferred_talk_level: v ? Number(v) : null })}>
                <SelectTrigger className="rounded-none h-9 text-xs"><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">静かに過ごしたい</SelectItem>
                  <SelectItem value="1">あまり話さない</SelectItem>
                  <SelectItem value="2">普通</SelectItem>
                  <SelectItem value="3">たくさん話したい</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">香りの好み</Label>
              <Input value={chart.preferred_scent || ""}
                onChange={(e) => setChart({ ...chart, preferred_scent: e.target.value || null })}
                placeholder="例: 強い香りNG"
                className="rounded-none h-9 text-xs" />
            </div>
          </div>
        </div>
      </div>

      {/* 内部メモ */}
      <div>
        <p className="eyebrow text-[10px] mb-3">— Internal Notes —</p>
        <Textarea value={chart.internal_notes || ""}
          onChange={(e) => setChart({ ...chart, internal_notes: e.target.value || null })}
          placeholder="スタッフ間共有メモ（家族構成、職業、結婚記念日など）"
          className="rounded-none text-xs min-h-[80px]" />
      </div>
    </div>
  );
};

export default CustomerChartPanel;
