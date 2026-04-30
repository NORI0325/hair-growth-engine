import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Gift, Sparkles, Crown, Star, Leaf, Percent } from "lucide-react";

type Incentive = {
  id?: string;
  owner_id?: string;
  kind: string;
  title: string;
  description: string | null;
  terms: string | null;
  estimated_cost: number;
  value_label: string | null;
  target_segment: string;
  active: boolean;
  sort_order: number;
  usage_limit: number | null;
  used_count: number;
  valid_until: string | null;
};

const KIND_META: Record<string, { label: string; icon: any; color: string }> = {
  gift:         { label: "ギフト",       icon: Gift,     color: "bg-pink-100 text-pink-700" },
  service_addon:{ label: "サービス追加", icon: Sparkles, color: "bg-purple-100 text-purple-700" },
  upgrade:      { label: "アップグレード", icon: Star,    color: "bg-amber-100 text-amber-700" },
  priority:     { label: "優先特典",     icon: Crown,    color: "bg-yellow-100 text-yellow-700" },
  experience:   { label: "体験",         icon: Leaf,     color: "bg-green-100 text-green-700" },
  discount:     { label: "割引",         icon: Percent,  color: "bg-rose-100 text-rose-700" },
};

const SEGMENT_LABEL: Record<string, string> = {
  all: "全員", new: "新規", active: "アクティブ", at_risk: "離脱予兆", dormant: "離脱済", vip: "VIP",
};

const EMPTY: Incentive = {
  kind: "gift", title: "", description: "", terms: "",
  estimated_cost: 0, value_label: "", target_segment: "all",
  active: true, sort_order: 0, usage_limit: null, used_count: 0, valid_until: null,
};

const Incentives = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Incentive[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Incentive | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("incentives")
      .select("*")
      .eq("owner_id", user.id)
      .order("sort_order", { ascending: true });
    if (error) toast.error("読込失敗: " + error.message);
    setItems((data as Incentive[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const handleSave = async () => {
    if (!editing || !user) return;
    if (!editing.title.trim()) { toast.error("特典名を入力してください"); return; }
    const payload = { ...editing, owner_id: user.id };
    const { error } = editing.id
      ? await supabase.from("incentives").update(payload).eq("id", editing.id)
      : await supabase.from("incentives").insert(payload);
    if (error) { toast.error("保存失敗: " + error.message); return; }
    toast.success("保存しました");
    setOpen(false); setEditing(null); load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("削除しますか？")) return;
    const { error } = await supabase.from("incentives").delete().eq("id", id);
    if (error) { toast.error("削除失敗: " + error.message); return; }
    toast.success("削除しました"); load();
  };

  const toggleActive = async (it: Incentive) => {
    await supabase.from("incentives").update({ active: !it.active }).eq("id", it.id!);
    load();
  };

  return (
    <AppLayout>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="eyebrow text-[10px] mb-3">INCENTIVES · 特典マスター</div>
          <h1 className="font-serif text-4xl text-foreground">復活・離脱防止 特典</h1>
          <p className="text-sm text-muted-foreground mt-2">
            割引以外にも、ギフト・サービス追加・優先予約など、ブランドを守る多彩な特典を管理できます
          </p>
        </div>
        <Button onClick={() => { setEditing({ ...EMPTY, sort_order: items.length + 1 }); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />新しい特典
        </Button>
      </div>

      {/* LINE連動の説明バナー */}
      <div className="mb-6 p-4 border border-gold/30 bg-gold/5 rounded-none">
        <p className="text-xs leading-relaxed text-foreground">
          <span className="font-serif text-gold">📱 LINEリッチメニューと連動しています</span><br />
          <span className="text-muted-foreground">
            お客様がLINEのリッチメニューから「特典」をタップすると、<strong className="text-foreground">この画面で「有効」になっている特典</strong>が、お客様のセグメント（新規 / アクティブ / 離脱予備 / 休眠 / VIP）に合わせて自動表示されます。<br />
            不要な特典は <strong>右側のスイッチでOFF</strong> に、内容は <strong>編集ボタン</strong> から変更できます。期限切れ（valid_until 経過）も自動で非表示になります。
          </span>
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">読込中...</p>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">特典がありません</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => {
            const meta = KIND_META[it.kind] || KIND_META.gift;
            const Icon = meta.icon;
            return (
              <Card key={it.id} className={`transition-opacity ${it.active ? "" : "opacity-50"}`}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <Badge className={`${meta.color} border-0`}><Icon className="w-3 h-3 mr-1" />{meta.label}</Badge>
                    <Switch checked={it.active} onCheckedChange={() => toggleActive(it)} />
                  </div>
                  <h3 className="font-serif text-lg leading-tight">{it.title}</h3>
                  {it.value_label && (
                    <div className="text-xs font-medium text-primary">{it.value_label}</div>
                  )}
                  {it.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{it.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Badge variant="outline" className="text-[10px]">対象: {SEGMENT_LABEL[it.target_segment] || it.target_segment}</Badge>
                    {it.estimated_cost > 0 && (
                      <Badge variant="outline" className="text-[10px]">原価 ¥{it.estimated_cost.toLocaleString()}</Badge>
                    )}
                    {it.valid_until && (
                      <Badge variant="outline" className="text-[10px]">〜{it.valid_until}</Badge>
                    )}
                  </div>
                  <div className="flex gap-2 pt-2 border-t">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditing(it); setOpen(true); }}>
                      <Pencil className="w-3 h-3 mr-1" />編集
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDelete(it.id!)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "特典を編集" : "新しい特典"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">種類</Label>
                  <Select value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(KIND_META).map(([k, m]) => (
                        <SelectItem key={k} value={k}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">対象セグメント</Label>
                  <Select value={editing.target_segment} onValueChange={(v) => setEditing({ ...editing, target_segment: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEGMENT_LABEL).map(([k, l]) => (
                        <SelectItem key={k} value={k}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">特典名 *</Label>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="🎁 ヘアオイル ミニサイズ プレゼント" />
              </div>
              <div>
                <Label className="text-xs">お客様への見せ方ラベル</Label>
                <Input value={editing.value_label || ""} onChange={(e) => setEditing({ ...editing, value_label: e.target.value })} placeholder="¥1,500相当" />
              </div>
              <div>
                <Label className="text-xs">説明文（メッセージに差し込まれます）</Label>
                <Textarea rows={3} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">利用条件</Label>
                <Textarea rows={2} value={editing.terms || ""} onChange={(e) => setEditing({ ...editing, terms: e.target.value })} placeholder="次回ご来店時、お会計時にお渡しします。" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">想定原価（円）</Label>
                  <Input type="number" value={editing.estimated_cost} onChange={(e) => setEditing({ ...editing, estimated_cost: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label className="text-xs">利用上限（任意）</Label>
                  <Input type="number" value={editing.usage_limit ?? ""} onChange={(e) => setEditing({ ...editing, usage_limit: e.target.value ? Number(e.target.value) : null })} />
                </div>
                <div>
                  <Label className="text-xs">有効期限（任意）</Label>
                  <Input type="date" value={editing.valid_until ?? ""} onChange={(e) => setEditing({ ...editing, valid_until: e.target.value || null })} />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                <span className="text-xs">{editing.active ? "有効" : "無効"}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Incentives;
