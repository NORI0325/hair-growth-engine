import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Coins, Sparkles, Settings as SettingsIcon } from "lucide-react";

type Item = {
  id?: string;
  name: string;
  description: string | null;
  points_cost: number;
  kind: string;
  active: boolean;
  sort_order: number;
  stock: number | null;
};

const EMPTY: Item = {
  name: "", description: "", points_cost: 500, kind: "service_addon",
  active: true, sort_order: 0, stock: null,
};

const PRESETS: Item[] = [
  { name: "🌿 ヘッドスパ 10分追加", description: "施術中にヘッドスパを10分プラス。リラックス感が違います。", points_cost: 500, kind: "service_addon", active: true, sort_order: 1, stock: null },
  { name: "💎 トリートメント アップグレード", description: "通常コースを上位グレードへ無料アップグレード。", points_cost: 1000, kind: "upgrade", active: true, sort_order: 2, stock: null },
  { name: "🍃 ヘッドスパ 20分", description: "通常メニューのヘッドスパ20分を無料でお付けします。", points_cost: 1500, kind: "service_addon", active: true, sort_order: 3, stock: null },
  { name: "🌹 プレミアムトリートメント無料", description: "ハイダメージ毛にも効くプレミアムトリートメントを1回無料で。", points_cost: 2000, kind: "service_addon", active: true, sort_order: 4, stock: null },
  { name: "✨ ヘッドスパフルコース 40分", description: "極上の40分ヘッドスパをご提供。", points_cost: 3000, kind: "experience", active: true, sort_order: 5, stock: null },
];

const Points = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState({
    points_enabled: true,
    points_earn_rate_percent: 5,
    points_signup_bonus: 1000,
  });

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [itemsRes, profileRes] = await Promise.all([
      supabase.from("point_redemption_items").select("*").eq("owner_id", tenantId).order("sort_order"),
      supabase.from("profiles").select("points_enabled, points_earn_rate_percent, points_signup_bonus").eq("id", tenantId).maybeSingle(),
    ]);
    setItems((itemsRes.data as any) || []);
    if (profileRes.data) setSettings(profileRes.data as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const saveSettings = async () => {
    if (!tenantId) return;
    const { error } = await supabase.from("profiles").update(settings).eq("id", tenantId);
    if (error) { toast.error("保存失敗: " + error.message); return; }
    toast.success("設定を保存しました");
  };

  const saveItem = async () => {
    if (!editing || !user || !tenantId) return;
    if (!editing.name.trim()) { toast.error("名前を入力してください"); return; }
    const payload: any = { ...editing, owner_id: tenantId, location_id: locationId };
    const { error } = editing.id
      ? await supabase.from("point_redemption_items").update(payload).eq("id", editing.id)
      : await supabase.from("point_redemption_items").insert(payload);
    if (error) { toast.error("保存失敗: " + error.message); return; }
    toast.success("保存しました");
    setOpen(false); setEditing(null); load();
  };

  const deleteItem = async (id: string) => {
    if (!confirm("削除しますか？")) return;
    const { error } = await supabase.from("point_redemption_items").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const toggleActive = async (it: Item) => {
    await supabase.from("point_redemption_items").update({ active: !it.active }).eq("id", it.id!);
    load();
  };

  const addPresets = async () => {
    if (!user || !tenantId) return;
    if (!confirm("おすすめ交換アイテム5件を追加しますか？")) return;
    const payload = PRESETS.map(p => ({ ...p, owner_id: tenantId, location_id: locationId }));
    const { error } = await supabase.from("point_redemption_items").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("追加しました"); load();
  };

  return (
    <AppLayout>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="eyebrow text-[10px] mb-3">POINTS · ポイント・交換アイテム</div>
          <h1 className="font-serif text-4xl text-foreground">ポイント制度</h1>
          <p className="text-sm text-muted-foreground mt-2">
            自社チャネル予約のお客様にポイントを付与し、サービスアップグレードと交換できます
          </p>
        </div>
      </div>

      {/* 設計思想説明 */}
      <div className="mb-6 p-4 border border-gold/30 bg-gold/5 rounded-none">
        <p className="text-xs leading-relaxed text-foreground">
          <span className="font-serif text-gold">💡 ホットペッパー切替の仕組み</span><br />
          <span className="text-muted-foreground">
            ポイントは <strong className="text-foreground">LINE・自社予約のみ</strong> で付与されます（ホットペッパー予約では付与されません）。
            さらに、ポイントは <strong>現金値引きではなくサービスアップグレード</strong> と交換するため、
            ブランドや単価を下げずに切り替えを促進できます。
          </span>
        </p>
      </div>

      {/* 設定 */}
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <SettingsIcon className="w-4 h-4 text-gold" />
            <h2 className="font-serif text-lg">基本設定</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <Switch checked={settings.points_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, points_enabled: v })} />
              <div>
                <p className="text-sm font-medium">ポイント機能</p>
                <p className="text-[10px] text-muted-foreground">{settings.points_enabled ? "有効" : "無効"}</p>
              </div>
            </div>
            <div>
              <Label className="text-xs">獲得率（%）</Label>
              <Input type="number" min={0} max={50} value={settings.points_earn_rate_percent}
                onChange={(e) => setSettings({ ...settings, points_earn_rate_percent: Number(e.target.value) || 0 })} />
              <p className="text-[10px] text-muted-foreground mt-1">来店会計のこの%をポイント付与</p>
            </div>
            <div>
              <Label className="text-xs">LINE連携ボーナス（pt）</Label>
              <Input type="number" min={0} value={settings.points_signup_bonus}
                onChange={(e) => setSettings({ ...settings, points_signup_bonus: Number(e.target.value) || 0 })} />
              <p className="text-[10px] text-muted-foreground mt-1">初めてLINE連携した時に1度だけ付与</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={saveSettings} size="sm">設定を保存</Button>
          </div>
        </CardContent>
      </Card>

      {/* 交換アイテム */}
      <div className="flex items-end justify-between mb-4">
        <h2 className="font-serif text-2xl">交換アイテム</h2>
        <div className="flex gap-2">
          {items.length === 0 && (
            <Button variant="outline" onClick={addPresets}>
              <Sparkles className="w-4 h-4 mr-2" />おすすめを追加
            </Button>
          )}
          <Button onClick={() => { setEditing({ ...EMPTY, sort_order: items.length + 1 }); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />新しいアイテム
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">読込中...</p>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          交換アイテムがありません。「おすすめを追加」から始めましょう。
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(it => (
            <Card key={it.id} className={it.active ? "" : "opacity-50"}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <Badge className="bg-gold/10 text-gold border-0">
                    <Coins className="w-3 h-3 mr-1" />{it.points_cost.toLocaleString()} pt
                  </Badge>
                  <Switch checked={it.active} onCheckedChange={() => toggleActive(it)} />
                </div>
                <h3 className="font-serif text-lg leading-tight">{it.name}</h3>
                {it.description && <p className="text-xs text-muted-foreground line-clamp-3">{it.description}</p>}
                {it.stock !== null && (
                  <Badge variant="outline" className="text-[10px]">在庫: {it.stock}</Badge>
                )}
                <div className="flex gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditing(it); setOpen(true); }}>
                    <Pencil className="w-3 h-3 mr-1" />編集
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => deleteItem(it.id!)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "アイテムを編集" : "新しい交換アイテム"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs">アイテム名 *</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="🌿 ヘッドスパ 10分追加" />
              </div>
              <div>
                <Label className="text-xs">説明</Label>
                <Textarea rows={3} value={editing.description || ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">必要ポイント *</Label>
                  <Input type="number" min={1} value={editing.points_cost}
                    onChange={(e) => setEditing({ ...editing, points_cost: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label className="text-xs">在庫（任意）</Label>
                  <Input type="number" value={editing.stock ?? ""}
                    onChange={(e) => setEditing({ ...editing, stock: e.target.value ? Number(e.target.value) : null })}
                    placeholder="制限なし" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                <span className="text-xs">{editing.active ? "有効" : "無効"}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button onClick={saveItem}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Points;
