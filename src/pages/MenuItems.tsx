import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, GripVertical, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

interface MenuItem {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: number;
  sort_order: number;
  active: boolean;
  image_url: string | null;
  description: string | null;
}

const MenuItems = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: "", duration_minutes: 60, buffer_minutes: 15, price: 0 });

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("menu_items")
      .select("*")
      .eq("owner_id", user.id)
      .order("sort_order", { ascending: true });
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const add = async () => {
    if (!user) return;
    if (!draft.name.trim()) { toast.error("メニュー名を入力してください"); return; }
    setSaving(true);
    const max = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
    const { error } = await supabase.from("menu_items").insert({
      owner_id: user.id,
      name: draft.name.trim().slice(0, 80),
      duration_minutes: draft.duration_minutes,
      buffer_minutes: draft.buffer_minutes,
      price: draft.price,
      sort_order: max + 1,
    });
    setSaving(false);
    if (error) { toast.error("追加に失敗しました: " + error.message); return; }
    setDraft({ name: "", duration_minutes: 60, buffer_minutes: 15, price: 0 });
    toast.success("メニューを追加しました");
    load();
  };

  const update = async (id: string, patch: Partial<MenuItem>) => {
    setItems(items.map(i => i.id === id ? { ...i, ...patch } : i));
    const { error } = await supabase.from("menu_items").update(patch).eq("id", id);
    if (error) { toast.error("更新に失敗: " + error.message); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("このメニューを削除しますか？")) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) { toast.error("削除に失敗: " + error.message); return; }
    toast.success("削除しました");
    load();
  };

  return (
    <AppLayout>
      <PageHeader
        title="メニュー管理"
        eyebrow="— Menu Items —"
        description="お客様が予約時に選べるメニューを管理します。所要時間と料金を設定すると、予約画面で合計が自動計算されます。"
      />

      {/* 追加フォーム */}
      <div className="border border-border p-6 mb-8">
        <p className="eyebrow mb-4">— Add Menu —</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2">
            <Label className="font-serif text-xs mb-2 block">メニュー名</Label>
            <Input value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}
              placeholder="例：カット" className="rounded-none" />
          </div>
          <div>
            <Label className="font-serif text-xs mb-2 block">所要時間（分）</Label>
            <Input type="number" min={5} step={5} value={draft.duration_minutes}
              onChange={e => setDraft({...draft, duration_minutes: Number(e.target.value)})}
              className="rounded-none" />
          </div>
          <div>
            <Label className="font-serif text-xs mb-2 block">バッファ（分）</Label>
            <Input type="number" min={0} step={5} value={draft.buffer_minutes}
              onChange={e => setDraft({...draft, buffer_minutes: Number(e.target.value)})}
              className="rounded-none" />
          </div>
          <div>
            <Label className="font-serif text-xs mb-2 block">料金（円）</Label>
            <Input type="number" min={0} step={100} value={draft.price}
              onChange={e => setDraft({...draft, price: Number(e.target.value)})}
              className="rounded-none" />
          </div>
        </div>
        <Button onClick={add} disabled={saving} className="mt-4 rounded-none tracking-luxury">
          {saving ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-2" />}
          追加 <span className="ml-2 opacity-60 text-[10px]">ADD</span>
        </Button>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="eyebrow mb-2">— No Menus —</p>
          <p className="text-sm">最初のメニューを追加しましょう</p>
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {items.map(item => (
            <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-secondary/30 transition-colors">
              <div className="md:col-span-1 text-muted-foreground hidden md:flex">
                <GripVertical className="w-4 h-4" />
              </div>
              <div className="md:col-span-3">
                <Input value={item.name} onChange={e => update(item.id, { name: e.target.value })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
              </div>
              <div className="md:col-span-2">
                <Input type="number" value={item.duration_minutes}
                  onChange={e => update(item.id, { duration_minutes: Number(e.target.value) })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                <span className="text-[10px] text-muted-foreground ml-1">分</span>
              </div>
              <div className="md:col-span-2">
                <Input type="number" value={item.buffer_minutes}
                  onChange={e => update(item.id, { buffer_minutes: Number(e.target.value) })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                <span className="text-[10px] text-muted-foreground ml-1">バッファ</span>
              </div>
              <div className="md:col-span-2">
                <Input type="number" value={item.price}
                  onChange={e => update(item.id, { price: Number(e.target.value) })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                <span className="text-[10px] text-muted-foreground ml-1">円</span>
              </div>
              <div className="md:col-span-1 flex items-center gap-2">
                <Switch checked={item.active} onCheckedChange={(v) => update(item.id, { active: v })} />
              </div>
              <div className="md:col-span-1 flex justify-end">
                <Button size="icon" variant="ghost" onClick={() => remove(item.id)}>
                  <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-6 border border-gold/30 bg-secondary/20">
        <p className="eyebrow mb-3 text-gold">— Tips —</p>
        <ul className="text-xs text-muted-foreground space-y-2 leading-relaxed">
          <li>• <strong>バッファ時間</strong>：施術後の片付け・カウンセリングなど。次のお客様までの余裕時間として確保されます。</li>
          <li>• <strong>無効化</strong>：スイッチをオフにすると、お客様の予約画面に表示されなくなります（既存データは残ります）。</li>
          <li>• <strong>並び順</strong>：上から順に予約画面に表示されます。</li>
        </ul>
      </div>
    </AppLayout>
  );
};

export default MenuItems;
