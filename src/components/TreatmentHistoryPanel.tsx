import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useActiveStaff } from "@/hooks/useActiveStaff";
import { compressImage } from "@/lib/imageCompress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Image as ImageIcon, Camera, Trash2, Sparkles, Copy } from "lucide-react";
import { toast } from "sonner";

interface RecipeRow { brand: string; name: string; ratio: string; oxy: string; time_minutes: string; area: string }

interface Treatment {
  id?: string;
  customer_id: string;
  staff_id: string | null;
  treatment_date: string;
  menu_summary: string | null;
  color_recipe: RecipeRow[];
  perm_recipe: RecipeRow[];
  before_photo_url: string | null;
  after_photo_url: string | null;
  duration_minutes: number | null;
  customer_reaction: string | null;
  next_suggestion: string | null;
  staff_notes: string | null;
}

const emptyRow = (): RecipeRow => ({ brand: "", name: "", ratio: "", oxy: "", time_minutes: "", area: "" });

const empty = (customerId: string): Treatment => ({
  customer_id: customerId, staff_id: null,
  treatment_date: new Date().toISOString().slice(0, 10),
  menu_summary: null, color_recipe: [], perm_recipe: [],
  before_photo_url: null, after_photo_url: null,
  duration_minutes: null, customer_reaction: null,
  next_suggestion: null, staff_notes: null,
});

interface Staff { id: string; name: string }

export const TreatmentHistoryPanel = ({ customerId }: { customerId: string }) => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const { active: activeStaff } = useActiveStaff();
  const [list, setList] = useState<Treatment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Treatment | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"before" | "after" | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const startNew = () => {
    const seed = empty(customerId);
    if (activeStaff) seed.staff_id = activeStaff.id;
    setEditing(seed);
  };

  // 前回の施術を雛形にコピー（薬剤・メニュー）
  const copyFromPrevious = () => {
    if (!editing || list.length === 0) return;
    const prev = list[0];
    setEditing({
      ...editing,
      menu_summary: prev.menu_summary,
      color_recipe: JSON.parse(JSON.stringify(prev.color_recipe || [])),
      perm_recipe: JSON.parse(JSON.stringify(prev.perm_recipe || [])),
      next_suggestion: prev.next_suggestion,
    });
    toast.success("前回のレシピをコピーしました");
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("chart_treatments")
      .select("*")
      .eq("customer_id", customerId)
      .order("treatment_date", { ascending: false })
      .limit(50);
    setList((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    (async () => {
      if (!user) return;
      const { data: tm } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", user.id).maybeSingle();
      setTenantId(tm?.tenant_id || user.id);
      const { data: s } = await supabase.from("staff").select("id,name").eq("active", true);
      setStaff(s || []);
    })();
  }, [customerId, user]);

  const uploadPhoto = async (file: File, type: "before" | "after"): Promise<string | null> => {
    if (!editing || !tenantId) return null;
    const compressed = await compressImage(file);
    const path = `${tenantId}/${customerId}/${Date.now()}-${type}.jpg`;
    const { error } = await supabase.storage.from("chart-photos").upload(path, compressed, { contentType: "image/jpeg" });
    if (error) { toast.error("写真アップロード失敗: " + error.message); return null; }
    return path;
  };

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>, type: "before" | "after") => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setUploading(type);
    const path = await uploadPhoto(file, type);
    setUploading(null);
    e.target.value = "";
    if (!path) return;
    setEditing({ ...editing, [type === "before" ? "before_photo_url" : "after_photo_url"]: path });
    toast.success(type === "before" ? "Before写真を保存" : "After写真を保存");
  };

  const save = async () => {
    if (!editing || !user) return;
    setSaving(true);
    const payload: any = {
      ...editing,
      staff_id: editing.staff_id || activeStaff?.id || null,
      owner_id: user.id,
      location_id: locationId,
    };
    let error;
    if (editing.id) {
      ({ error } = await supabase.from("chart_treatments").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("chart_treatments").insert(payload));
    }
    setSaving(false);
    if (error) { toast.error("保存失敗: " + error.message); return; }
    toast.success("施術履歴を保存しました");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("削除しますか？")) return;
    const { error } = await supabase.from("chart_treatments").delete().eq("id", id);
    if (error) { toast.error("削除失敗"); return; }
    toast.success("削除しました");
    load();
  };

  const photoUrl = (path: string | null) => {
    if (!path) return null;
    const { data } = supabase.storage.from("chart-photos").getPublicUrl(path);
    // bucket is private — getPublicUrl won't work; use signed URLs lazily via state if needed
    return data.publicUrl;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold" />
          <h3 className="font-serif text-base">施術履歴 <span className="eyebrow text-[10px] text-muted-foreground ml-2">Treatment History</span></h3>
        </div>
        <Button size="sm" onClick={startNew} className="rounded-none">
          <Plus className="w-3 h-3 mr-1" />追加
        </Button>
      </div>

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">施術履歴はまだありません</p>
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <div key={t.id} className="border border-border p-3 hover:bg-secondary/30 cursor-pointer" onClick={() => setEditing(t)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-serif">{t.treatment_date} <span className="text-muted-foreground ml-2">{t.menu_summary || "—"}</span></div>
                  {t.next_suggestion && <div className="text-[10px] text-gold mt-0.5">次回: {t.next_suggestion}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.before_photo_url && <span className="text-[10px] text-muted-foreground"><ImageIcon className="w-3 h-3 inline" /> B</span>}
                  {t.after_photo_url && <span className="text-[10px] text-muted-foreground"><ImageIcon className="w-3 h-3 inline" /> A</span>}
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); remove(t.id!); }} className="h-6 w-6 p-0">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto rounded-none p-4 md:p-6">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center justify-between gap-2">
              <span>施術カルテ <span className="eyebrow text-[10px] text-muted-foreground ml-2">Treatment Record</span></span>
              {!editing?.id && list.length > 0 && (
                <Button size="sm" variant="outline" onClick={copyFromPrevious} className="rounded-none text-[11px] h-8">
                  <Copy className="w-3 h-3 mr-1" />前回コピー
                </Button>
              )}
            </DialogTitle>
            {activeStaff && <p className="text-[10px] text-muted-foreground">操作中: {activeStaff.name}</p>}
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-[11px]">施術日</Label>
                  <Input type="date" value={editing.treatment_date}
                    onChange={(e) => setEditing({ ...editing, treatment_date: e.target.value })}
                    className="rounded-none h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px]">担当スタッフ</Label>
                  <select value={editing.staff_id || ""}
                    onChange={(e) => setEditing({ ...editing, staff_id: e.target.value || null })}
                    className="w-full h-9 text-xs border border-input bg-background px-2">
                    <option value="">選択</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-[11px]">所要時間（分）</Label>
                  <Input type="number" value={editing.duration_minutes ?? ""}
                    onChange={(e) => setEditing({ ...editing, duration_minutes: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-none h-9 text-xs" />
                </div>
              </div>
              <div>
                <Label className="text-[11px]">施術メニュー要約</Label>
                <Input value={editing.menu_summary || ""}
                  onChange={(e) => setEditing({ ...editing, menu_summary: e.target.value || null })}
                  placeholder="例: カット＋カラー＋トリートメント"
                  className="rounded-none h-9 text-xs" />
              </div>

              {/* カラーレシピ */}
              <RecipeEditor
                title="カラーレシピ"
                rows={editing.color_recipe || []}
                onChange={(rows) => setEditing({ ...editing, color_recipe: rows })}
              />
              {/* パーマレシピ */}
              <RecipeEditor
                title="パーマ・縮毛矯正レシピ"
                rows={editing.perm_recipe || []}
                onChange={(rows) => setEditing({ ...editing, perm_recipe: rows })}
              />

              {/* 写真 — モバイル: カメラ直撮り or 端末から選択 */}
              <div className="grid grid-cols-2 gap-3">
                {(["before", "after"] as const).map((type) => (
                  <div key={type}>
                    <Label className="text-[11px] flex items-center gap-1">
                      <Camera className="w-3 h-3" />{type === "before" ? "Before" : "After"}
                    </Label>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <label className="border border-input bg-background hover:bg-accent rounded-none h-12 flex flex-col items-center justify-center text-[10px] cursor-pointer">
                        <Camera className="w-4 h-4 mb-0.5" />撮影
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                          onChange={(e) => onPhotoChange(e, type)} />
                      </label>
                      <label className="border border-input bg-background hover:bg-accent rounded-none h-12 flex flex-col items-center justify-center text-[10px] cursor-pointer">
                        <ImageIcon className="w-4 h-4 mb-0.5" />選択
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => onPhotoChange(e, type)} />
                      </label>
                    </div>
                    {uploading === type && <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />アップロード中...</div>}
                    {editing[type === "before" ? "before_photo_url" : "after_photo_url"] && <PhotoThumb path={editing[type === "before" ? "before_photo_url" : "after_photo_url"]!} />}
                  </div>
                ))}
              </div>

              <div>
                <Label className="text-[11px]">お客様反応</Label>
                <select value={editing.customer_reaction || ""}
                  onChange={(e) => setEditing({ ...editing, customer_reaction: e.target.value || null })}
                  className="w-full h-9 text-xs border border-input bg-background px-2">
                  <option value="">選択</option>
                  <option value="delighted">😍 大喜び</option>
                  <option value="satisfied">😊 満足</option>
                  <option value="neutral">😐 普通</option>
                  <option value="dissatisfied">😟 不満</option>
                </select>
              </div>
              <div>
                <Label className="text-[11px]">次回への提案</Label>
                <Textarea value={editing.next_suggestion || ""}
                  onChange={(e) => setEditing({ ...editing, next_suggestion: e.target.value || null })}
                  placeholder="例: 6週間後にリタッチ推奨。色味は半トーン明るくしても良さそう"
                  className="rounded-none text-xs min-h-[60px]" />
              </div>
              <div>
                <Label className="text-[11px]">スタッフメモ</Label>
                <Textarea value={editing.staff_notes || ""}
                  onChange={(e) => setEditing({ ...editing, staff_notes: e.target.value || null })}
                  className="rounded-none text-xs min-h-[60px]" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} className="rounded-none">キャンセル</Button>
            <Button onClick={save} disabled={saving} className="rounded-none">
              {saving && <Loader2 className="w-3 h-3 animate-spin mr-2" />}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const PhotoThumb = ({ path }: { path: string }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("chart-photos").createSignedUrl(path, 3600).then(({ data }) => {
      setUrl(data?.signedUrl || null);
    });
  }, [path]);
  if (!url) return null;
  return <img src={url} alt="" className="mt-2 w-full h-32 object-cover" />;
};

const RecipeEditor = ({ title, rows, onChange }: { title: string; rows: RecipeRow[]; onChange: (r: RecipeRow[]) => void }) => {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-[11px] font-serif">{title}</Label>
        <Button size="sm" variant="ghost" onClick={() => onChange([...rows, emptyRow()])} className="h-7 text-[10px]">
          <Plus className="w-3 h-3 mr-1" />追加
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">なし</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="border border-border p-2 space-y-1.5 bg-secondary/20">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">#{i + 1}</span>
                <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="h-6 w-6 p-0">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              {/* モバイル: 縦積み 2列 / デスクトップ: 6列 */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5">
                <Input placeholder="ブランド" value={r.brand} onChange={(e) => { const n = [...rows]; n[i].brand = e.target.value; onChange(n); }} className="rounded-none h-9 text-xs" />
                <Input placeholder="薬剤名" value={r.name} onChange={(e) => { const n = [...rows]; n[i].name = e.target.value; onChange(n); }} className="rounded-none h-9 text-xs md:col-span-2" />
                <Input placeholder="比率" value={r.ratio} onChange={(e) => { const n = [...rows]; n[i].ratio = e.target.value; onChange(n); }} className="rounded-none h-9 text-xs" />
                <Input placeholder="OX%" inputMode="decimal" value={r.oxy} onChange={(e) => { const n = [...rows]; n[i].oxy = e.target.value; onChange(n); }} className="rounded-none h-9 text-xs" />
                <Input placeholder="放置(分)" inputMode="numeric" value={r.time_minutes} onChange={(e) => { const n = [...rows]; n[i].time_minutes = e.target.value; onChange(n); }} className="rounded-none h-9 text-xs" />
                <Input placeholder="部位（根元/中間/毛先など）" value={r.area} onChange={(e) => { const n = [...rows]; n[i].area = e.target.value; onChange(n); }} className="rounded-none h-9 text-xs col-span-2 md:col-span-6" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TreatmentHistoryPanel;
