import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X, Tag as TagIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Tag { id: string; name: string; color: string; }

interface Props {
  customerId: string;
  ownerId: string | null;
}

const COLORS = ["#C5A572", "#D67373", "#7AA67A", "#7593C5", "#A77AC5", "#C57AA5", "#999999"];

const CustomerTagEditor = ({ customerId, ownerId }: Props) => {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: tags }, { data: asg }] = await Promise.all([
      supabase.from("customer_tags" as any).select("id, name, color").order("sort_order").order("name"),
      supabase.from("customer_tag_assignments" as any).select("tag_id").eq("customer_id", customerId),
    ]);
    setAllTags((tags || []) as any);
    setAssigned(new Set((asg || []).map((a: any) => a.tag_id)));
    setLoading(false);
  };

  useEffect(() => { if (customerId) load(); }, [customerId]);

  const toggleTag = async (tag: Tag) => {
    if (!ownerId) return;
    const has = assigned.has(tag.id);
    if (has) {
      const { error } = await supabase.from("customer_tag_assignments" as any)
        .delete().eq("customer_id", customerId).eq("tag_id", tag.id);
      if (error) { toast.error("削除に失敗しました"); return; }
      setAssigned((s) => { const n = new Set(s); n.delete(tag.id); return n; });
    } else {
      const { error } = await supabase.from("customer_tag_assignments" as any).insert({
        owner_id: ownerId, customer_id: customerId, tag_id: tag.id,
      });
      if (error) { toast.error("付与に失敗しました"); return; }
      setAssigned((s) => new Set(s).add(tag.id));
    }
  };

  const createTag = async () => {
    const name = newTag.trim();
    if (!name || !ownerId) return;
    setCreating(true);
    const color = COLORS[allTags.length % COLORS.length];
    const { data, error } = await supabase.from("customer_tags" as any).insert({
      owner_id: ownerId, name, color,
    }).select("id, name, color").maybeSingle();
    setCreating(false);
    if (error || !data) {
      toast.error(error?.message?.includes("duplicate") ? "同名のタグが既にあります" : "作成に失敗しました");
      return;
    }
    const created = data as any;
    setAllTags((t) => [...t, created]);
    setNewTag("");
    // 作ったらこの顧客にも付ける
    await supabase.from("customer_tag_assignments" as any).insert({
      owner_id: ownerId, customer_id: customerId, tag_id: created.id,
    });
    setAssigned((s) => new Set(s).add(created.id));
    toast.success(`タグ「${name}」を作成して付与しました`);
  };

  if (loading) return (
    <div className="border border-border p-3 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="w-3 h-3 animate-spin" />タグを読み込み中...
    </div>
  );

  return (
    <div className="border border-border p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <TagIcon className="w-3 h-3 text-gold" />
        <p className="eyebrow text-[10px]">— タグ —</p>
      </div>
      {allTags.length === 0 && (
        <p className="text-[11px] text-muted-foreground">まだタグがありません。下のフォームから作成できます。</p>
      )}
      {allTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {allTags.map((t) => {
            const on = assigned.has(t.id);
            return (
              <button key={t.id} type="button" onClick={() => toggleTag(t)}
                className={`px-2.5 py-1 text-[11px] border transition-colors flex items-center gap-1 ${on ? "text-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                style={on
                  ? { backgroundColor: `${t.color}22`, borderColor: t.color }
                  : { borderLeftWidth: 3, borderLeftColor: t.color }}>
                {t.name}
                {on && <X className="w-2.5 h-2.5" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-1.5 pt-1 border-t border-border">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="新しいタグ名（例: 縮毛矯正希望）"
          className="rounded-none h-8 text-xs"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createTag(); } }}
        />
        <Button type="button" size="sm" onClick={createTag} disabled={!newTag.trim() || creating}
          className="rounded-none h-8 px-3 text-[11px] bg-foreground hover:bg-foreground/90">
          {creating ? <Loader2 className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
        </Button>
      </div>
    </div>
  );
};

export default CustomerTagEditor;
