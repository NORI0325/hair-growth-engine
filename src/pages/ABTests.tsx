import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, FlaskConical, Pause, Play, BarChart3 } from "lucide-react";
import { toast } from "sonner";

interface Test {
  id: string;
  name: string;
  template_key: string;
  status: string;
  variant_a: any;
  variant_b: any;
  split_ratio: number;
  started_at: string;
  ended_at: string | null;
}

interface Stats {
  variant: string;
  assigned: number;
  sent: number;
  opened: number;
  clicked: number;
  booked: number;
}

const TEMPLATE_OPTIONS = [
  { key: "reactivation", label: "復活クーポン" },
  { key: "birthday", label: "お誕生日" },
  { key: "next_suggestion", label: "次回ご提案" },
  { key: "thank_you", label: "サンクス" },
  { key: "review_request", label: "レビュー依頼" },
];

export default function ABTests() {
  const { user } = useAuth();
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [statsByTest, setStatsByTest] = useState<Record<string, Stats[]>>({});

  // form
  const [form, setForm] = useState({
    name: "", template_key: "reactivation",
    a_subject: "", a_body: "",
    b_subject: "", b_body: "",
  });

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("ab_tests" as any)
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    const list = (data as any) || [];
    setTests(list);

    // 各テストの統計を集計
    const stats: Record<string, Stats[]> = {};
    for (const t of list) {
      const { data: assigns } = await supabase
        .from("ab_test_assignments" as any)
        .select("variant, sent_at, opened_at, clicked_at, booked_at")
        .eq("ab_test_id", t.id);
      const rows = (assigns as any) || [];
      const variants: Stats[] = ["A", "B"].map(v => {
        const sub = rows.filter((r: any) => r.variant === v);
        return {
          variant: v,
          assigned: sub.length,
          sent: sub.filter((r: any) => r.sent_at).length,
          opened: sub.filter((r: any) => r.opened_at).length,
          clicked: sub.filter((r: any) => r.clicked_at).length,
          booked: sub.filter((r: any) => r.booked_at).length,
        };
      });
      stats[t.id] = variants;
    }
    setStatsByTest(stats);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const create = async () => {
    if (!form.name.trim() || !form.a_body.trim() || !form.b_body.trim()) {
      toast.error("名前、A・Bの本文は必須です");
      return;
    }
    const { error } = await supabase.from("ab_tests" as any).insert({
      owner_id: user!.id,
      name: form.name,
      template_key: form.template_key,
      variant_a: { subject: form.a_subject, body: form.a_body },
      variant_b: { subject: form.b_subject, body: form.b_body },
      split_ratio: 0.5,
      status: "active",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("A/Bテストを開始しました");
    setOpen(false);
    setForm({ name: "", template_key: "reactivation", a_subject: "", a_body: "", b_subject: "", b_body: "" });
    load();
  };

  const toggle = async (t: Test) => {
    const next = t.status === "active" ? "paused" : "active";
    await supabase.from("ab_tests" as any).update({ status: next }).eq("id", t.id);
    load();
  };

  const end = async (t: Test) => {
    if (!confirm("このテストを終了します。よろしいですか？")) return;
    await supabase.from("ab_tests" as any).update({
      status: "ended", ended_at: new Date().toISOString(),
    }).eq("id", t.id);
    load();
  };

  const winner = (s: Stats[]): "A" | "B" | "tie" | null => {
    const [a, b] = s;
    if (!a || !b || (a.sent + b.sent) < 10) return null;
    const aRate = a.sent ? a.booked / a.sent : 0;
    const bRate = b.sent ? b.booked / b.sent : 0;
    if (Math.abs(aRate - bRate) < 0.01) return "tie";
    return aRate > bRate ? "A" : "B";
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.06 — Experiments"
        title="A/B テスト"
        description="二つの文面を半々に送って、どちらが響くかを静かに測ります。"
      />

      <div className="flex justify-end mb-6">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-none"><Plus className="w-3 h-3 mr-1" />新しいテスト</Button>
          </DialogTrigger>
          <DialogContent className="rounded-none max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <p className="eyebrow mb-2">— New Experiment —</p>
              <DialogTitle className="display text-xl">A/Bテストを作成</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="mb-2 block font-serif text-sm">テスト名</Label>
                <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                  placeholder="例: 復活クーポン 件名比較"
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold"/>
              </div>
              <div>
                <Label className="mb-2 block font-serif text-sm">対象テンプレート</Label>
                <select value={form.template_key} onChange={e => setForm({...form, template_key: e.target.value})}
                  className="w-full bg-transparent border-b border-input py-2 focus:outline-none focus:border-gold text-sm">
                  {TEMPLATE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-border">
                <div className="space-y-3">
                  <p className="eyebrow text-gold">— Variant A —</p>
                  <Input value={form.a_subject} onChange={e => setForm({...form, a_subject: e.target.value})}
                    placeholder="件名 A"
                    className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold"/>
                  <textarea value={form.a_body} onChange={e => setForm({...form, a_body: e.target.value})}
                    rows={6} placeholder="本文 A"
                    className="w-full rounded-none border border-border bg-transparent p-2 text-sm focus:outline-none focus:border-gold resize-none"/>
                </div>
                <div className="space-y-3">
                  <p className="eyebrow">— Variant B —</p>
                  <Input value={form.b_subject} onChange={e => setForm({...form, b_subject: e.target.value})}
                    placeholder="件名 B"
                    className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold"/>
                  <textarea value={form.b_body} onChange={e => setForm({...form, b_body: e.target.value})}
                    rows={6} placeholder="本文 B"
                    className="w-full rounded-none border border-border bg-transparent p-2 text-sm focus:outline-none focus:border-gold resize-none"/>
                </div>
              </div>

              <Button onClick={create} className="w-full rounded-none py-6 text-xs tracking-luxury">
                テストを開始
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-20"><Loader2 className="w-4 h-4 mx-auto animate-spin text-muted-foreground"/></div>
      ) : tests.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border">
          <FlaskConical className="w-6 h-6 mx-auto mb-3 text-muted-foreground"/>
          <p className="font-serif text-sm">まだテストはありません</p>
          <p className="text-xs text-muted-foreground mt-2">
            同じ目的の文面を2パターン用意して、どちらが響くか測りましょう。
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {tests.map(t => {
            const s = statsByTest[t.id] || [];
            const w = winner(s);
            return (
              <div key={t.id} className="border border-border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-serif text-lg">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {TEMPLATE_OPTIONS.find(o => o.key === t.template_key)?.label || t.template_key}
                      ・開始 {new Date(t.started_at).toLocaleDateString("ja-JP")}
                      ・<span className={
                        t.status === "active" ? "text-gold" :
                        t.status === "paused" ? "text-amber-600" : "text-muted-foreground"
                      }>{t.status}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {t.status !== "ended" && (
                      <Button size="sm" variant="ghost" onClick={() => toggle(t)}>
                        {t.status === "active" ? <Pause className="w-3 h-3"/> : <Play className="w-3 h-3"/>}
                      </Button>
                    )}
                    {t.status !== "ended" && (
                      <Button size="sm" variant="outline" onClick={() => end(t)}>終了</Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px bg-border border border-border">
                  {s.map((v) => (
                    <div key={v.variant} className={`bg-background p-4 ${w === v.variant ? "ring-2 ring-gold" : ""}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="eyebrow">— Variant {v.variant} —</p>
                        {w === v.variant && <span className="text-[10px] text-gold">勝ち</span>}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                        {(v.variant === "A" ? t.variant_a : t.variant_b)?.subject || "(件名なし)"}
                      </p>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><p className="text-lg font-serif-en">{v.sent}</p><p className="text-[9px] text-muted-foreground">配信</p></div>
                        <div><p className="text-lg font-serif-en">{v.opened}</p><p className="text-[9px] text-muted-foreground">開封</p></div>
                        <div><p className="text-lg font-serif-en">{v.clicked}</p><p className="text-[9px] text-muted-foreground">クリック</p></div>
                        <div><p className="text-lg font-serif-en text-gold">{v.booked}</p><p className="text-[9px] text-muted-foreground">予約</p></div>
                      </div>
                      {v.sent > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-2 text-center">
                          予約率 {((v.booked / v.sent) * 100).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {w === "tie" && (
                  <p className="text-[11px] text-muted-foreground mt-3 text-center">
                    <BarChart3 className="w-3 h-3 inline mr-1"/>差は誤差の範囲です
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
