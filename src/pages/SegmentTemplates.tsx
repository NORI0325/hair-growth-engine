import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Save, AlertTriangle } from "lucide-react";

type Segment = "cold_1" | "warm_mid" | "loyal_risk" | "lost_1" | "churned" | "vip_lost";

interface SegRow {
  id?: string;
  owner_id?: string;
  segment: Segment;
  enabled: boolean;
  subject: string | null;
  body: string | null;
  cta_label: string | null;
  discount_percent: number | null;
  tone: string | null;
}

const SEGMENTS: { key: Segment; title: string; desc: string; psych: string; warn?: boolean }[] = [
  { key: "cold_1",     title: "ワンショット離脱（1回・90-180日）", desc: "試したけれど定着しなかった層。ブランド帰属意識ゼロ。", psych: "強オファー＋再認知が鍵。割引30%程度の強い背中押しを。" },
  { key: "warm_mid",   title: "軽度離脱（2-3回・90-180日）",       desc: "悪くないけど決め手がない、比較検討で失注した層。", psych: "指名化のきっかけ作り。スタイリスト名やメニュー固定提案。" },
  { key: "loyal_risk", title: "元常連の離脱予備軍（4回+・90-180日）", desc: "何かが起きて足が遠のいている可能性。", psych: "割引より「気にかけてる」姿勢。担当者からの一言が刺さる。" },
  { key: "lost_1",     title: "ワンショット休眠（1回・180日+）",   desc: "ほぼ戻らない。配信頻度を下げて季節挨拶程度に。", psych: "低頻度・低圧で。送りすぎは逆効果。" },
  { key: "churned",    title: "離脱（2-3回・180日+）",             desc: "不満かライフイベントで離れた可能性。", psych: "謝罪トーン＋ヒアリング。お詫びクーポンが効果的。" },
  { key: "vip_lost",   title: "⚠ VIP離脱（高額/高頻度・180日+）", desc: "致命的な何かが起きた可能性。自動配信は逆効果。", psych: "オーナー自ら手書きLINE/お電話を強く推奨。承認待ちキューに必ず入ります。", warn: true },
];

const PLACEHOLDERS = "{customer_name} {salon_name} {months_since} {days_since}";

export default function SegmentTemplates() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Record<Segment, SegRow>>({} as any);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("reactivation_segment_templates" as any)
      .select("*")
      .eq("owner_id", user.id);
    if (error) toast.error(error.message);
    const byKey: any = {};
    SEGMENTS.forEach(s => {
      const found = (data as any[] | null)?.find(d => d.segment === s.key);
      byKey[s.key] = found || {
        segment: s.key, enabled: true, subject: "", body: "", cta_label: "", discount_percent: null, tone: "polite",
      };
    });
    setRows(byKey);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const save = async (seg: Segment) => {
    if (!user) return;
    setSaving(seg);
    const r = rows[seg];
    const payload = {
      owner_id: user.id,
      segment: seg,
      enabled: r.enabled,
      subject: r.subject || null,
      body: r.body || null,
      cta_label: r.cta_label || null,
      discount_percent: r.discount_percent != null && !Number.isNaN(Number(r.discount_percent)) ? Number(r.discount_percent) : null,
      tone: r.tone || "polite",
    };
    const { error } = await supabase
      .from("reactivation_segment_templates" as any)
      .upsert(payload, { onConflict: "owner_id,segment" });
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success("保存しました");
  };

  const update = (seg: Segment, patch: Partial<SegRow>) => {
    setRows(prev => ({ ...prev, [seg]: { ...prev[seg], ...patch } }));
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.05 — Segments"
        title="セグメント別 復活メッセージ"
        description="同じ「離脱」でも来店回数で心理は全く違います。属性ごとに最適な文面を設計しましょう。"
      />

      <div className="mb-6 p-4 border border-gold/20 bg-gold/5 text-xs leading-relaxed">
        利用可能な変数: <code className="text-gold">{PLACEHOLDERS}</code><br />
        本文の最後にはサロン名・予約リンク・割引情報が自動付与されます。
      </div>

      {loading ? (
        <div className="py-20 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" /></div>
      ) : (
        <div className="space-y-6">
          {SEGMENTS.map(s => {
            const r = rows[s.key];
            if (!r) return null;
            return (
              <div key={s.key} className={`border ${s.warn ? "border-destructive/40 bg-destructive/5" : "border-border"} p-5`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {s.warn && <AlertTriangle className="w-4 h-4 text-destructive" />}
                      <h3 className="font-serif text-sm">{s.title}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.desc}</p>
                    <p className="text-[11px] text-gold mt-1">💡 {s.psych}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Label className="text-[10px] text-muted-foreground">配信</Label>
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={v => update(s.key, { enabled: v })}
                      disabled={s.key === "vip_lost"}
                    />
                  </div>
                </div>

                {s.key === "vip_lost" && (
                  <div className="mb-3 p-3 bg-destructive/10 text-destructive text-[11px]">
                    VIP離脱は<strong>必ずオーナー承認が必要</strong>な設定にロックされています。自動配信は事故防止のため無効です。
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">件名</Label>
                    <Input
                      value={r.subject || ""}
                      onChange={e => update(s.key, { subject: e.target.value })}
                      className="rounded-none h-9 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">CTAラベル</Label>
                    <Input
                      value={r.cta_label || ""}
                      onChange={e => update(s.key, { cta_label: e.target.value })}
                      className="rounded-none h-9 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">割引% (空白=ステージ既定)</Label>
                    <Input
                      type="number" min={0} max={100}
                      value={r.discount_percent ?? ""}
                      onChange={e => update(s.key, { discount_percent: e.target.value === "" ? null : parseInt(e.target.value) })}
                      className="rounded-none h-9 text-xs"
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <Label className="text-[10px] text-muted-foreground">本文</Label>
                  <Textarea
                    value={r.body || ""}
                    onChange={e => update(s.key, { body: e.target.value })}
                    rows={6}
                    className="rounded-none text-xs"
                  />
                </div>

                <div className="flex justify-end">
                  <Button size="sm" onClick={() => save(s.key)} disabled={saving === s.key}
                    className="rounded-none">
                    {saving === s.key ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                    保存
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
