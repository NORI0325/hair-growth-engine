import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
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
interface MenuOpt { id: string; name: string; duration_minutes: number | null; price: number | null; }

interface Props {
  onCreated?: () => void;
  trigger?: React.ReactNode;
}

export default function ManualBookingDialog({ onCreated, trigger }: Props) {
  const { user } = useAuth();
  const locationId = useCurrentLocationId();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [menus, setMenus] = useState<MenuOpt[]>([]);
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
    if (!open || !user) return;
    (async () => {
      const [c, s, m] = await Promise.all([
        supabase.from("customers").select("id, full_name, phone").order("created_at", { ascending: false }).limit(500),
        supabase.from("staff").select("id, name").eq("active", true).order("sort_order"),
        supabase.from("menu_items").select("id, name, duration_minutes, price").eq("active", true).order("sort_order"),
      ]);
      setCustomers((c.data as CustomerOpt[]) || []);
      setStaff((s.data as StaffOpt[]) || []);
      setMenus((m.data as MenuOpt[]) || []);
    })();
  }, [open, user]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    return customers.filter((c) =>
      c.full_name.toLowerCase().includes(q) || (c.phone || "").includes(q)
    ).slice(0, 50);
  }, [customers, customerSearch]);

  const totalDuration = useMemo(() => {
    return menus.filter((m) => selectedMenus.includes(m.name)).reduce((a, m) => a + (m.duration_minutes || 0), 0);
  }, [menus, selectedMenus]);

  const reset = () => {
    setCustomerId(""); setStaffId(""); setSelectedMenus([]); setNotes(""); setCustomerSearch("");
  };

  const submit = async () => {
    if (!customerId) { toast.error("顧客を選択してください"); return; }
    if (selectedMenus.length === 0) { toast.error("メニューを選択してください"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("staff-create-booking", {
        body: {
          customer_id: customerId,
          staff_id: staffId || null,
          booking_date: date,
          booking_time: time,
          menus: selectedMenus,
          notes: notes || null,
          location_id: locationId || null,
        },
      });
      if (error) throw error;
      const r = data as any;
      if (!r?.success) throw new Error(r?.message || "作成に失敗しました");

      if (r.sync_status === "success") {
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
    } catch (e: any) {
      toast.error(e?.message || "作成に失敗しました");
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
            <div className="border border-border max-h-48 overflow-y-auto p-2 space-y-1">
              {menus.map((m) => {
                const checked = selectedMenus.includes(m.name);
                return (
                  <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedMenus([...selectedMenus, m.name]);
                        else setSelectedMenus(selectedMenus.filter((x) => x !== m.name));
                      }}
                    />
                    <span className="flex-1">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{m.duration_minutes}分 / ¥{m.price?.toLocaleString()}</span>
                  </label>
                );
              })}
            </div>
            {selectedMenus.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">合計 {totalDuration}分</p>
            )}
          </div>

          <div>
            <Label className="text-xs">備考（任意）</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-none" rows={2} maxLength={500} />
          </div>

          <p className="text-xs text-muted-foreground border-l-2 border-gold pl-2">
            予約は仮受付として保存され、外部媒体（サロンボード等）への同期成功後に確定になります。同期に時間がかかる場合（最大15秒）、バックグラウンドで処理を続けます。
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" className="rounded-none" onClick={() => setOpen(false)} disabled={submitting}>
            キャンセル
          </Button>
          <Button className="rounded-none" onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />同期中...</> : "予約を作成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
