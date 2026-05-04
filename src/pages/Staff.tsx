import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Clock, Calendar as CalIcon, Plug } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCurrentLocationId } from "@/hooks/useLocations";
import ChannelMappingDialog from "@/components/ChannelMappingDialog";

interface Staff {
  id: string;
  name: string;
  display_color: string;
  bookable: boolean;
  active: boolean;
  sort_order: number;
  note: string | null;
  pin_code: string | null;
}

interface Schedule {
  id: string;
  staff_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  active: boolean;
}

interface TimeOff {
  id: string;
  staff_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const PALETTE = ["#C9A961", "#8B7355", "#A8B5A0", "#9C7C8C", "#6B8E9E", "#B89968", "#7A8B6F"];

const StaffPage = () => {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [timeOffs, setTimeOffs] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ name: "", color: PALETTE[0] });
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [mappingStaff, setMappingStaff] = useState<Staff | null>(null);
  const [timeOffDraft, setTimeOffDraft] = useState({ start: "", end: "", reason: "" });

  const load = async () => {
    if (!user || !locationId) { setStaff([]); setSchedules([]); setTimeOffs([]); setLoading(false); return; }
    setLoading(true);
    const [s, sc, t] = await Promise.all([
      supabase.from("staff").select("*").eq("location_id", locationId).order("sort_order"),
      supabase.from("staff_schedules").select("*").eq("location_id", locationId),
      supabase.from("staff_time_off").select("*").eq("location_id", locationId).gte("end_at", new Date().toISOString()).order("start_at"),
    ]);
    setStaff(s.data || []);
    setSchedules(sc.data || []);
    setTimeOffs(t.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, locationId]);

  const addStaff = async () => {
    if (!user || !locationId || !draft.name.trim()) { toast.error("名前を入力してください"); return; }
    const max = staff.reduce((m, s) => Math.max(m, s.sort_order), 0);
    const { error } = await supabase.from("staff").insert({
      owner_id: user.id,
      location_id: locationId,
      name: draft.name.trim().slice(0, 50),
      display_color: draft.color,
      sort_order: max + 1,
    });
    if (error) { toast.error("追加失敗: " + error.message); return; }
    setDraft({ name: "", color: PALETTE[(staff.length + 1) % PALETTE.length] });
    toast.success("スタッフを追加しました");
    load();
  };

  const removeStaff = async (id: string) => {
    if (!confirm("このスタッフを削除しますか？関連する勤務時間・休暇も削除されます。")) return;
    const { error } = await supabase.from("staff").delete().eq("id", id);
    if (error) { toast.error("削除失敗: " + error.message); return; }
    toast.success("削除しました");
    load();
  };

  const toggleActive = async (s: Staff, field: "active" | "bookable") => {
    const patch = field === "active" ? { active: !s.active } : { bookable: !s.bookable };
    const { error } = await supabase.from("staff").update(patch).eq("id", s.id);
    if (error) { toast.error("更新失敗"); return; }
    load();
  };

  const updateSchedule = async (sched: Schedule, patch: Partial<Schedule>) => {
    const { error } = await supabase.from("staff_schedules").update(patch).eq("id", sched.id);
    if (error) { toast.error("更新失敗"); return; }
    load();
  };

  const addTimeOff = async () => {
    if (!user || !editingStaff || !locationId) return;
    if (!timeOffDraft.start || !timeOffDraft.end) { toast.error("日時を入力してください"); return; }
    const { error } = await supabase.from("staff_time_off").insert({
      owner_id: user.id,
      location_id: locationId,
      staff_id: editingStaff.id,
      start_at: new Date(timeOffDraft.start).toISOString(),
      end_at: new Date(timeOffDraft.end).toISOString(),
      reason: timeOffDraft.reason || null,
    });
    if (error) { toast.error("追加失敗: " + error.message); return; }
    setTimeOffDraft({ start: "", end: "", reason: "" });
    toast.success("休暇を登録しました");
    load();
  };

  const removeTimeOff = async (id: string) => {
    const { error } = await supabase.from("staff_time_off").delete().eq("id", id);
    if (error) { toast.error("削除失敗"); return; }
    load();
  };

  const staffSchedules = (staffId: string) => {
    const arr = schedules.filter(s => s.staff_id === staffId);
    return WEEKDAYS.map((_, w) => arr.find(s => s.weekday === w) || null);
  };

  const staffTimeOffs = (staffId: string) => timeOffs.filter(t => t.staff_id === staffId);

  return (
    <AppLayout>
      <PageHeader
        eyebrow="No.14 — Staff"
        title="スタッフ管理"
        description="スタッフごとに勤務時間と休暇を設定すると、空き予約枠が自動で計算されます"
      />

      {/* 追加フォーム */}
      <div className="border border-border p-6 mb-12">
        <div className="eyebrow mb-4 text-[10px]">— New Staff Member —</div>
        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-5">
            <Label className="text-xs">名前</Label>
            <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="例：山田 太郎" className="rounded-none mt-1" />
          </div>
          <div className="col-span-5">
            <Label className="text-xs">表示色</Label>
            <div className="flex gap-2 mt-2">
              {PALETTE.map(c => (
                <button key={c} type="button"
                  onClick={() => setDraft({ ...draft, color: c })}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${draft.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="col-span-2">
            <Button onClick={addStaff} className="w-full rounded-none">
              <Plus className="w-3.5 h-3.5 mr-1" />追加
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-24 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" /></div>
      ) : staff.length === 0 ? (
        <div className="py-24 text-center">
          <p className="eyebrow mb-3">— No Staff Yet —</p>
          <p className="text-sm text-muted-foreground">スタッフを追加すると、自動で月〜土 10:00-19:00 の勤務時間が設定されます</p>
        </div>
      ) : (
        <div className="space-y-8">
          {staff.map(s => {
            const scheds = staffSchedules(s.id);
            const offs = staffTimeOffs(s.id);
            return (
              <div key={s.id} className="border border-border">
                <div className="flex items-center justify-between p-6 border-b border-border">
                  <div className="flex items-center gap-4">
                    <div className="w-3 h-3 rounded-full" style={{ background: s.display_color }} />
                    <div>
                      <div className="font-serif text-lg">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.active ? "有効" : "無効"} ・ {s.bookable ? "予約受付中" : "予約停止"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">有効</Label>
                      <Switch checked={s.active} onCheckedChange={() => toggleActive(s, "active")} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">予約受付</Label>
                      <Switch checked={s.bookable} onCheckedChange={() => toggleActive(s, "bookable")} />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">PIN</Label>
                      <Input
                        type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                        defaultValue={s.pin_code || ""}
                        placeholder="4-6桁"
                        className="rounded-none h-8 w-20 text-xs text-center"
                        onBlur={async (e) => {
                          const v = e.target.value.trim();
                          if (v === (s.pin_code || "")) return;
                          if (v && !/^[0-9]{4,6}$/.test(v)) { toast.error("PINは数字4〜6桁"); return; }
                          const { error } = await supabase.from("staff").update({ pin_code: v || null }).eq("id", s.id);
                          if (error) { toast.error("PIN保存失敗: " + error.message); return; }
                          toast.success("PINを保存");
                          load();
                        }}
                      />
                    </div>
                    <Button variant="ghost" size="sm" className="rounded-none" onClick={() => setEditingStaff(s)}>
                      <CalIcon className="w-3.5 h-3.5 mr-1" />休暇
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-none text-destructive" onClick={() => removeStaff(s.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* 勤務時間 */}
                <div className="p-6">
                  <div className="eyebrow text-[10px] mb-3 flex items-center gap-2">
                    <Clock className="w-3 h-3" />Working Hours
                  </div>
                  <div className="grid grid-cols-7 gap-3">
                    {scheds.map((sc, w) => (
                      <div key={w} className={`border ${sc?.active ? "border-gold/40" : "border-border bg-muted/20"} p-3`}>
                        <div className="text-xs font-serif mb-2 text-center">{WEEKDAYS[w]}</div>
                        {sc ? (
                          <>
                            <div className="flex items-center justify-center mb-2">
                              <Switch checked={sc.active} onCheckedChange={() => updateSchedule(sc, { active: !sc.active })} />
                            </div>
                            <div className={`space-y-1 ${sc.active ? "" : "opacity-40"}`}>
                              <Input type="time" value={sc.start_time.slice(0, 5)} disabled={!sc.active}
                                onChange={e => updateSchedule(sc, { start_time: e.target.value + ":00" })}
                                className="rounded-none text-xs h-7" />
                              <Input type="time" value={sc.end_time.slice(0, 5)} disabled={!sc.active}
                                onChange={e => updateSchedule(sc, { end_time: e.target.value + ":00" })}
                                className="rounded-none text-xs h-7" />
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-muted-foreground text-center py-2">—</div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* 休暇一覧 */}
                  {offs.length > 0 && (
                    <div className="mt-6">
                      <div className="eyebrow text-[10px] mb-2">— Upcoming Time Off —</div>
                      <div className="space-y-1">
                        {offs.map(t => (
                          <div key={t.id} className="flex items-center justify-between text-xs py-2 border-b border-border/40">
                            <span>
                              {new Date(t.start_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              {" 〜 "}
                              {new Date(t.end_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              {t.reason && <span className="ml-2 text-muted-foreground">— {t.reason}</span>}
                            </span>
                            <Button variant="ghost" size="sm" className="rounded-none h-6" onClick={() => removeTimeOff(t.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 休暇追加ダイアログ */}
      <Dialog open={!!editingStaff} onOpenChange={(o) => !o && setEditingStaff(null)}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-serif">{editingStaff?.name} の休暇登録</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">開始日時</Label>
              <Input type="datetime-local" value={timeOffDraft.start}
                onChange={e => setTimeOffDraft({ ...timeOffDraft, start: e.target.value })}
                className="rounded-none mt-1" />
            </div>
            <div>
              <Label className="text-xs">終了日時</Label>
              <Input type="datetime-local" value={timeOffDraft.end}
                onChange={e => setTimeOffDraft({ ...timeOffDraft, end: e.target.value })}
                className="rounded-none mt-1" />
            </div>
            <div>
              <Label className="text-xs">理由（任意）</Label>
              <Input value={timeOffDraft.reason}
                onChange={e => setTimeOffDraft({ ...timeOffDraft, reason: e.target.value })}
                placeholder="例：研修 / 私用 / 休憩"
                className="rounded-none mt-1" />
            </div>
            <Button onClick={addTimeOff} className="w-full rounded-none">登録</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default StaffPage;
