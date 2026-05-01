import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, MessageCircle, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useCurrentLocationId } from "@/hooks/useLocations";

interface PendingFriend {
  id: string;
  line_user_id: string;
  display_name: string | null;
  last_message: string | null;
  created_at: string;
}

interface Props {
  onConverted: () => void;
}

const PendingLineFriends = ({ onConverted }: Props) => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const [items, setItems] = useState<PendingFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<PendingFriend | null>(null);
  const [form, setForm] = useState({ full_name: "", phone: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const load = async () => {
    if (!user || !locationId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("line_pending_friends")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, locationId]);

  const openConvert = (p: PendingFriend) => {
    setTarget(p);
    setForm({
      full_name: p.display_name || "",
      phone: "",
      email: "",
    });
  };

  const convert = async () => {
    if (!user || !target) return;
    if (!locationId) { toast.error("店舗が選択されていません"); return; }
    if (!form.full_name.trim()) { toast.error("お名前を入力してください"); return; }
    setSaving(true);
    // 顧客作成
    const { error } = await supabase.from("customers").insert({
      owner_id: user.id,
      location_id: locationId,
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      line_user_id: target.line_user_id,
    });
    if (error) { setSaving(false); toast.error("登録に失敗: " + error.message); return; }
    // pending削除
    await supabase.from("line_pending_friends").delete().eq("id", target.id);
    setSaving(false);
    setTarget(null);
    toast.success("顧客として登録しました");
    load();
    onConverted();
  };

  const dismiss = async (id: string) => {
    if (!confirm("このLINE友だちをリストから削除しますか？")) return;
    await supabase.from("line_pending_friends").delete().eq("id", id);
    load();
  };

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <div className="border border-[#06C755]/30 bg-[#06C755]/5 mb-8">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between p-5 hover:bg-[#06C755]/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#06C755] flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className="eyebrow text-[10px] text-[#06C755]">— Pending LINE Friends —</p>
            <p className="font-serif text-sm">未連携のLINE友だち <span className="text-[#06C755] font-bold">{items.length}名</span></p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{collapsed ? "▼ 表示" : "▲ 閉じる"}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-[#06C755]/20 divide-y divide-[#06C755]/10">
          {items.map(p => (
            <div key={p.id} className="p-5 flex items-center justify-between gap-4 hover:bg-[#06C755]/5 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="font-serif text-sm">
                  {p.display_name || <span className="text-muted-foreground">名前未取得</span>}
                </p>
                {p.last_message && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    最終メッセージ: 「{p.last_message}」
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-1 font-serif-en">
                  {new Date(p.created_at).toLocaleDateString("ja-JP")}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => openConvert(p)}
                  className="rounded-none bg-[#06C755] hover:bg-[#06C755]/90 text-white text-xs">
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" />顧客に登録
                </Button>
                <Button size="icon" variant="ghost" onClick={() => dismiss(p.id)} title="削除">
                  <X className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 変換ダイアログ */}
      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent className="rounded-none max-w-md">
          <DialogHeader>
            <p className="eyebrow mb-2 text-[#06C755]">— Convert to Guest —</p>
            <DialogTitle className="display text-2xl">LINE友だちを顧客登録</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="p-3 bg-secondary/50 text-xs text-muted-foreground">
              LINE ID: <span className="font-mono">{target?.line_user_id.slice(0, 12)}...</span>
              {target?.last_message && (
                <div className="mt-2">最終メッセージ:「{target.last_message}」</div>
              )}
            </div>
            <div>
              <Label className="font-serif text-xs mb-2 block">お名前 <span className="text-destructive">*</span></Label>
              <Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
                className="rounded-none" placeholder="山田 花子" />
            </div>
            <div>
              <Label className="font-serif text-xs mb-2 block">電話番号（任意）</Label>
              <Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                className="rounded-none" placeholder="未確認の場合は空欄でOK" />
            </div>
            <div>
              <Label className="font-serif text-xs mb-2 block">メール（任意）</Label>
              <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                className="rounded-none" />
            </div>
            <Button onClick={convert} disabled={saving}
              className="w-full rounded-none bg-[#06C755] hover:bg-[#06C755]/90 text-white tracking-luxury">
              {saving && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              この内容で顧客登録
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PendingLineFriends;
