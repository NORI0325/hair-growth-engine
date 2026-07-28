import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCurrentLocation } from "@/hooks/useLocations";

const schema = z.object({
  full_name: z.string().trim().min(1, "お名前は必須です").max(100),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email("正しいメールアドレス").max(255).optional().or(z.literal("")),
  birthday: z.string().optional(),
  last_visit_date: z.string().optional(),
  visit_count: z.coerce.number().int().min(0).max(10000).optional(),
  total_spent: z.coerce.number().int().min(0).max(100000000).optional(),
  line_user_id: z.string().trim().max(100).optional(),
  gender: z.enum(["female","male","other","unknown"]).optional(),
});

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: (customer?: AddedCustomer) => void;
}

export interface AddedCustomer {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
  line_user_id?: string | null;
  line_unfollowed_at?: string | null;
  opt_out_automation?: boolean | null;
  notes?: string | null;
  gender?: "female" | "male" | "other" | "unknown" | null;
  created_at?: string | null;
}

const customerSelect =
  "id, full_name, email, phone, birthday, last_visit_date, visit_count, total_spent, line_user_id, line_unfollowed_at, opt_out_automation, notes, gender, created_at";

const friendlyInsertError = (error: { code?: string; message?: string }) => {
  if (error.code === "23505") {
    return "同じLINE連携情報または外部IDの顧客が既に登録されています。既存顧客を検索してください。";
  }
  if (error.message?.toLowerCase().includes("row-level security")) {
    return "顧客を追加する権限、または店舗の所属情報を確認してください。";
  }
  return error.message ? `登録に失敗しました: ${error.message}` : "登録に失敗しました";
};

const AddCustomerDialog = ({ open, onOpenChange, onAdded }: Props) => {
  const { user } = useAuth();
  const { currentLocationId: locationId, currentLocation } = useCurrentLocation();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", birthday: "", last_visit_date: "", visit_count: "0", total_spent: "0", line_user_id: "", gender: "unknown" as "female"|"male"|"other"|"unknown" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!locationId) { toast.error("店舗が選択されていません"); return; }
    const ownerId = currentLocation?.tenant_id;
    if (!ownerId) { toast.error("店舗の所属情報を取得できませんでした。画面を再読み込みしてください。"); return; }
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    const normalizedPhone = (parsed.data.phone || "").replace(/\D/g, "") || null;
    setLoading(true);
    const { data, error } = await supabase.from("customers").insert({
      owner_id: ownerId,
      location_id: locationId,
      full_name: parsed.data.full_name,
      phone: normalizedPhone,
      email: parsed.data.email?.toLowerCase() || null,
      birthday: parsed.data.birthday || null,
      last_visit_date: parsed.data.last_visit_date || null,
      visit_count: parsed.data.visit_count ?? 0,
      total_spent: parsed.data.total_spent ?? 0,
      line_user_id: parsed.data.line_user_id || null,
      gender: form.gender,
    }).select(customerSelect).single();
    setLoading(false);
    if (error) {
      console.warn("[customers:add] insert failed", {
        code: error.code,
        message: error.message,
        ownerId,
        locationId,
      });
      toast.error(friendlyInsertError(error));
      return;
    }
    toast.success("顧客を追加しました");
    setForm({ full_name: "", phone: "", email: "", birthday: "", last_visit_date: "", visit_count: "0", total_spent: "0", line_user_id: "", gender: "unknown" });
    onOpenChange(false);
    onAdded(data as AddedCustomer);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none max-w-md">
        <DialogHeader>
          <p className="eyebrow mb-2">— Add Guest —</p>
          <DialogTitle className="display text-2xl">顧客を追加</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          <div>
            <Label className="mb-2 block font-serif text-sm">お名前 <span className="text-destructive">*</span> <span className="eyebrow text-[9px] text-muted-foreground ml-1">Full Name</span></Label>
            <Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
              required className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-2 block font-serif text-sm">電話番号 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Phone（任意）</span></Label>
              <Input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="mb-2 block font-serif text-sm">メール <span className="eyebrow text-[9px] text-muted-foreground ml-1">Email（任意）</span></Label>
              <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">性別 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Gender — セグメント配信用</span></Label>
            <div className="flex gap-2">
              {([["female","女性"],["male","男性"],["other","その他"],["unknown","未設定"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm({...form, gender: v})}
                  className={`flex-1 px-3 py-2 text-xs border rounded-none ${form.gender === v ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">誕生日 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Birthday — 誕生月クーポン自動配信</span></Label>
            <Input type="date" value={form.birthday} onChange={e => setForm({...form, birthday: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="mb-2 block font-serif text-sm">最終来店 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Last</span></Label>
              <Input type="date" value={form.last_visit_date} onChange={e => setForm({...form, last_visit_date: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="mb-2 block font-serif text-sm">来店回数 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Visits</span></Label>
              <Input type="number" min={0} value={form.visit_count} onChange={e => setForm({...form, visit_count: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="mb-2 block font-serif text-sm">累計売上 <span className="eyebrow text-[9px] text-muted-foreground ml-1">¥</span></Label>
              <Input type="number" min={0} value={form.total_spent} onChange={e => setForm({...form, total_spent: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">LINEユーザーID <span className="eyebrow text-[9px] text-muted-foreground ml-1">LINE User ID — LINE配信用</span></Label>
            <Input value={form.line_user_id} onChange={e => setForm({...form, line_user_id: e.target.value})}
              placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <Button type="submit" disabled={loading}
            className="w-full rounded-none py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow">
            {loading && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
            お客様を追加 <span className="ml-2 opacity-60 text-[10px]">ADD GUEST</span>
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddCustomerDialog;
