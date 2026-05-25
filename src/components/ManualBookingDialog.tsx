import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId, useTenantRole, hasMinRole } from "@/hooks/useTenant";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface CustomerOpt { id: string; full_name: string; phone: string | null; }
interface StaffOpt { id: string; name: string; }
interface MenuOpt {
  id: string;
  name: string;
  duration_minutes: number | null;
  price: number | null;
  is_salonboard_syncable?: boolean | null;
  external_setmenu_id?: string | null;
  rsv_term?: number | null;
}

interface StaffCreateBookingResponse {
  success?: boolean;
  message?: string;
  dispatch_mode?: string;
  sync_status?: string;
  external_reservation_id?: string | null;
  timed_out?: boolean;
  sync_error_message?: string | null;
}

interface Props {
  onCreated?: () => void;
  trigger?: React.ReactNode;
}

export default function ManualBookingDialog({ onCreated, trigger }: Props) {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const tenantId = useTenantId();
  const role = useTenantRole();
  const canUseTestMode = hasMinRole(role, "manager");
  const [open, setOpen] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [menus, setMenus] = useState<MenuOpt[]>([]);
  const [salonboardLive, setSalonboardLive] = useState(false);
  const [menuLoadError, setMenuLoadError] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [staffId, setStaffId] = useState<string>("");
  const [date, setDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState<string>("10:00");
  const [selectedMenus, setSelectedMenus] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !user || !tenantId) return;
    (async () => {
      setMenuLoadError(null);
      const menuQuery = locationId
        ? supabase.rpc("public_get_bookable_menus_v1", {
          _owner_id: tenantId,
          _location_id: locationId,
        })
        : Promise.resolve({ data: [], error: null });
      const liveQuery = locationId
        ? supabase
          .from("channel_integrations")
          .select("id")
          .eq("owner_id", tenantId)
          .eq("location_id", locationId)
          .eq("channel", "salonboard")
          .eq("enabled", true)
          .eq("sync_enabled", true)
          .eq("connection_status", "live")
          .limit(1)
        : Promise.resolve({ data: [], error: null });
      const [c, s, m, live] = await Promise.all([
        supabase.from("customers").select("id, full_name, phone").order("created_at", { ascending: false }).limit(500),
        supabase.from("staff").select("id, name").eq("active", true).order("sort_order"),
        menuQuery,
        liveQuery,
      ]);
      setCustomers((c.data as CustomerOpt[]) || []);
      setStaff((s.data as StaffOpt[]) || []);
      const isSalonboardLive = (live.data || []).length > 0;
      setSalonboardLive(isSalonboardLive);
      if (m.error) {
        console.error("[ManualBookingDialog] public_get_bookable_menus_v1 failed:", m.error);
        setMenus([]);
        setSelectedMenus([]);
        setMenuLoadError("メニュー情報を取得できませんでした。時間をおいて再度お試しください。");
        return;
      }
      const nextMenus = (m.data || []).map((row) => ({
        id: String(row.id),
        name: String(row.name || ""),
        duration_minutes: row.rsv_term == null
          ? (row.duration_minutes == null ? null : Number(row.duration_minutes))
          : Number(row.rsv_term),
        price: row.price == null ? null : Number(row.price),
        is_salonboard_syncable: row.is_salonboard_syncable ?? null,
        external_setmenu_id: row.external_setmenu_id ?? null,
        rsv_term: row.rsv_term == null ? null : Number(row.rsv_term),
      }));
      setMenus(nextMenus);
      setSelectedMenus((current) => {
        const allowed = current.filter((id) => nextMenus.some((m) => m.id === id));
        return isSalonboardLive ? allowed.slice(0, 1) : allowed;
      });
    })();
  }, [open, user, tenantId, locationId]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    return customers.filter((c) =>
      c.full_name.toLowerCase().includes(q) || (c.phone || "").includes(q)
    ).slice(0, 50);
  }, [customers, customerSearch]);

  const totalDuration = useMemo(() => {
    return menus.filter((m) => selectedMenus.includes(m.id)).reduce((a, m) => a + (m.rsv_term ?? m.duration_minutes ?? 0), 0);
  }, [menus, selectedMenus]);

  // 同名メニューに番号を付与して見分けやすくする
  const menusDisplay = useMemo(() => {
    const counts: Record<string, number> = {};
    const seen: Record<string, number> = {};
    menus.forEach((m) => { counts[m.name] = (counts[m.name] || 0) + 1; });
    return menus.map((m) => {
      const idx = (seen[m.name] = (seen[m.name] || 0) + 1);
      const suffix = counts[m.name] > 1 ? ` #${idx}` : "";
      return { ...m, label: `${m.name}${suffix}` };
    });
  }, [menus]);

  const reset = () => {
    setCustomerId(""); setStaffId(""); setSelectedMenus([]); setNotes(""); setCustomerSearch("");
    setMenuLoadError(null);
    setTestMode(false);
  };

  const submit = async () => {
    if (!locationId) { toast.error("店舗が未設定のため予約を作成できません。サイドバーから店舗を選択してください。"); return; }
    if (!customerId) { toast.error("顧客を選択してください"); return; }
    if (menuLoadError) { toast.error(menuLoadError); return; }
    if (selectedMenus.length === 0) { toast.error("メニューを選択してください"); return; }
    if (salonboardLive && selectedMenus.length !== 1) {
      toast.error("この店舗ではサロンボードへ同期可能なメニューを1つだけ選択してください。");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        customer_id: customerId,
        staff_id: staffId || null,
        booking_date: date,
        booking_time: time,
        menus: selectedMenus,
        notes: notes || null,
        location_id: locationId,
      };
      if (canUseTestMode && testMode) {
        const phase2Note = "Phase2実Worker往復テスト";
        const currentNotes = String(notes || "").trim();
        body.notes = currentNotes.includes(phase2Note)
          ? currentNotes
          : [currentNotes, phase2Note].filter(Boolean).join("\n");
        body.dispatch_mode = "skip";
        body.is_test = true;
      }
      const { data, error } = await supabase.functions.invoke("staff-create-booking", { body });
      if (error) throw error;
      const r = data as StaffCreateBookingResponse | null;
      if (!r?.success) throw new Error(r?.message || "作成に失敗しました");

      if (r.dispatch_mode === "skip") {
        toast.success("テスト予約を作成しました（Workerへは送信していません / pending のまま保持）", { icon: <CheckCircle2 className="h-4 w-4" /> });
      } else if (r.sync_status === "success") {
        toast.success(`予約を作成しサロンボードへ同期しました（${r.external_reservation_id || "ID取得済"}）`, { icon: <CheckCircle2 className="h-4 w-4" /> });
      } else if (r.timed_out || r.sync_status === "pending") {
        toast.warning("予約を作成しました。サロンボード同期はバックグラウンドで処理中です（要確認画面で結果を確認できます）", { icon: <AlertTriangle className="h-4 w-4" /> });
      } else if (r.sync_status === "needs_review") {
        toast.error(`予約は作成しましたが要スタッフ確認です: ${r.sync_error_message || ""}`);
      } else if (r.sync_status === "failed") {
        toast.error(`予約は作成しましたがサロンボード同期に失敗: ${r.sync_error_message || ""}`);
      } else {
        toast.success("予約を作成しました");
      }
      setOpen(false);
      reset();
      onCreated?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="rounded-none">
            <Plus className="h-4 w-4 mr-1" />新規予約
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <p className="text-xs tracking-[0.3em] text-gold uppercase">Manual Booking</p>
          <DialogTitle className="font-serif text-2xl">手動予約作成</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">顧客検索</Label>
            <Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="名前または電話番号" className="rounded-none" />
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="rounded-none mt-2">
                <SelectValue placeholder="顧客を選択" />
              </SelectTrigger>
              <SelectContent>
                {filteredCustomers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name} {c.phone ? `（${c.phone}）` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">日付</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-none" />
            </div>
            <div>
              <Label className="text-xs">時刻</Label>
              <Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className="rounded-none" />
            </div>
          </div>

          <div>
            <Label className="text-xs">スタッフ（任意）</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="指名なし" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">メニュー（複数選択可）</Label>
            {salonboardLive && (
              <div className="mb-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                この店舗ではサロンボードへ同期可能なメニューのみ手動予約に使用できます。複数メニューは選択できません。
              </div>
            )}
            {menuLoadError && (
              <div className="mb-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {menuLoadError}
              </div>
            )}
            <div className="border border-border max-h-48 overflow-y-auto p-2 space-y-1">
              {menusDisplay.map((m) => {
                const checked = selectedMenus.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedMenus(salonboardLive ? [m.id] : [...selectedMenus, m.id]);
                        else setSelectedMenus(selectedMenus.filter((x) => x !== m.id));
                      }}
                    />
                    <span className="flex-1">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.duration_minutes}分 / ¥{(m.price ?? 0).toLocaleString()}</span>
                  </label>
                );
              })}
              {menusDisplay.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">メニューが登録されていません。設定 → メニュー管理から追加してください。</p>
              )}
            </div>
            {salonboardLive && menusDisplay.length === 0 && (
              <p className="text-xs text-destructive mt-1">
                この店舗ではサロンボードへ同期可能なメニューがありません。サロンボード側のsetmenu同期状態を確認してください。
              </p>
            )}
            {selectedMenus.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">合計 {totalDuration}分</p>
            )}
          </div>

          <div>
            <Label className="text-xs">備考（任意）</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-none" rows={2} maxLength={500} />
          </div>

          {canUseTestMode && (
            <label className="flex items-start gap-2 text-xs border border-dashed border-gold/60 p-2 bg-gold/5 cursor-pointer">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">テスト予約として作成（dispatchしない）</span>
                <span className="block text-muted-foreground mt-0.5">
                  booking と sync_job のみ作成し、サロンボードへは送信しません。is_test=true として保存され、Phase2実Worker往復テスト用に保持されます。
                </span>
              </span>
            </label>
          )}

          <p className="text-xs text-muted-foreground border-l-2 border-gold pl-2">
            予約は仮受付として保存され、外部媒体（サロンボード等）への同期成功後に確定になります。同期に時間がかかる場合（最大15秒）、バックグラウンドで処理を続けます。
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" className="rounded-none" onClick={() => setOpen(false)} disabled={submitting}>
            キャンセル
          </Button>
          <Button className="rounded-none" onClick={submit} disabled={submitting || !locationId || !!menuLoadError || (salonboardLive && menus.length === 0)}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />同期中...</> : "予約を作成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
