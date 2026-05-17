import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { CustomerInsightsPanel } from "@/components/CustomerInsightsPanel";
import CustomerDeliveryTimeline from "@/components/CustomerDeliveryTimeline";
import CustomerTagEditor from "@/components/CustomerTagEditor";
import { CustomerMessageDialog } from "@/components/CustomerMessageDialog";
import { useAuth } from "@/hooks/useAuth";

const schema = z.object({
  full_name: z.string().trim().min(1, "お名前は必須です").max(100),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email("正しいメールアドレス").max(255).optional().or(z.literal("")),
  birthday: z.string().optional(),
  last_visit_date: z.string().optional(),
  visit_count: z.coerce.number().int().min(0).max(10000).optional(),
  total_spent: z.coerce.number().int().min(0).max(100000000).optional(),
  line_user_id: z.string().trim().max(100).optional(),
  notes: z.string().max(2000).optional(),
  gender: z.enum(["female","male","other","unknown"]).optional(),
});

export interface EditableCustomer {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
  line_user_id?: string | null;
  notes?: string | null;
  opt_out_automation?: boolean | null;
  opt_out_reason?: string | null;
  line_unfollowed_at?: string | null;
  imported_from?: string | null;
  activated_at?: string | null;
  gender?: "female"|"male"|"other"|"unknown" | null;
}

interface Props {
  customer: EditableCustomer | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

const EditCustomerDialog = ({ customer, open, onOpenChange, onSaved }: Props) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "", phone: "", email: "", birthday: "",
    last_visit_date: "", visit_count: "0", total_spent: "0",
    line_user_id: "", notes: "",
    opt_out_automation: false, opt_out_reason: "",
    gender: "unknown" as "female"|"male"|"other"|"unknown",
  });

  useEffect(() => {
    if (customer) {
      setForm({
        full_name: customer.full_name || "",
        phone: customer.phone || "",
        email: customer.email || "",
        birthday: customer.birthday || "",
        last_visit_date: customer.last_visit_date || "",
        visit_count: String(customer.visit_count ?? 0),
        total_spent: String(customer.total_spent ?? 0),
        line_user_id: customer.line_user_id || "",
        notes: customer.notes || "",
        opt_out_automation: !!customer.opt_out_automation,
        opt_out_reason: customer.opt_out_reason || "",
        gender: (customer.gender as any) || "unknown",
      });
    }
  }, [customer]);

  if (!customer) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setLoading(true);
    const { error } = await supabase.from("customers").update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      birthday: parsed.data.birthday || null,
      last_visit_date: parsed.data.last_visit_date || null,
      visit_count: parsed.data.visit_count ?? 0,
      total_spent: parsed.data.total_spent ?? 0,
      line_user_id: parsed.data.line_user_id || null,
      notes: parsed.data.notes || null,
      gender: form.gender,
      opt_out_automation: form.opt_out_automation,
      opt_out_reason: form.opt_out_automation ? (form.opt_out_reason || null) : null,
      opt_out_at: form.opt_out_automation && !customer.opt_out_automation ? new Date().toISOString() : (form.opt_out_automation ? undefined : null),
    } as any).eq("id", customer.id);
    setLoading(false);
    if (error) { toast.error("更新に失敗しました: " + error.message); return; }
    toast.success("顧客情報を更新しました");
    onOpenChange(false);
    onSaved();
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await supabase.from("customers").delete().eq("id", customer.id);
    setDeleting(false);
    if (error) { toast.error("削除に失敗しました: " + error.message); return; }
    toast.success("顧客を削除しました");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <p className="eyebrow mb-2">— Edit Guest —</p>
          <DialogTitle className="display text-2xl">顧客情報を編集</DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <CustomerInsightsPanel customerId={customer.id} />
        </div>
        <div className="mt-6">
          <p className="eyebrow mb-3">— 配信履歴 / Delivery Timeline —</p>
          <CustomerDeliveryTimeline customerId={customer.id} />
        </div>
        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          <div>
            <Label className="mb-2 block font-serif text-sm">お名前 <span className="text-destructive">*</span></Label>
            <Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
              required className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-2 block font-serif text-sm">電話番号</Label>
              <Input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="mb-2 block font-serif text-sm">メール</Label>
              <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">性別</Label>
            <div className="flex gap-2">
              {([["female","女性"],["male","男性"],["other","その他"],["unknown","未設定"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm({...form, gender: v})}
                  className={`flex-1 px-3 py-2 text-xs border rounded-none ${form.gender === v ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">誕生日</Label>
            <Input type="date" value={form.birthday} onChange={e => setForm({...form, birthday: e.target.value})}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="mb-2 block font-serif text-sm">最終来店</Label>
              <Input type="date" value={form.last_visit_date} onChange={e => setForm({...form, last_visit_date: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="mb-2 block font-serif text-sm">来店回数</Label>
              <Input type="number" min={0} value={form.visit_count} onChange={e => setForm({...form, visit_count: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="mb-2 block font-serif text-sm">累計売上 ¥</Label>
              <Input type="number" min={0} value={form.total_spent} onChange={e => setForm({...form, total_spent: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">LINEユーザーID</Label>
            <Input value={form.line_user_id} onChange={e => setForm({...form, line_user_id: e.target.value})}
              placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">メモ</Label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              rows={3}
              className="w-full rounded-none border-x-0 border-t-0 border-b border-input bg-transparent px-0 py-2 text-sm focus-visible:outline-none focus-visible:border-gold resize-none" />
          </div>

          {/* タグ管理（一斉送信のセグメントに利用） */}
          <CustomerTagEditor customerId={customer.id} ownerId={user?.id ?? null} />

          {/* 自動配信オプトアウト */}
          <div className="border border-border p-4 bg-muted/30">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-serif text-sm">自動配信を停止する</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  ONにすると、復活クーポン・お誕生日メッセージなどの自動メールが、このお客様に届かなくなります。<br/>
                  予約確定・リマインドなどの取引メールは引き続き送信されます。
                </p>
              </div>
              <input
                type="checkbox"
                checked={form.opt_out_automation}
                onChange={e => setForm({...form, opt_out_automation: e.target.checked})}
                className="w-4 h-4 mt-1 accent-gold"
              />
            </div>
            {form.opt_out_automation && (
              <div className="mt-3">
                <Label className="text-[11px] text-muted-foreground mb-1 block">理由（任意）</Label>
                <Input
                  value={form.opt_out_reason}
                  onChange={e => setForm({...form, opt_out_reason: e.target.value})}
                  placeholder="例: 本人より配信不要のお申し出"
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold text-sm"
                />
              </div>
            )}
          </div>

          {/* サロンボード休眠インポート顧客の手動アクティブ化 */}
          {customer.imported_from === "salonboard" && !customer.activated_at && (
            <div className="border border-gold/40 p-4 bg-gold/5">
              <p className="font-serif text-sm mb-1">休眠（インポート）顧客です</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                サロンボードから一括取り込みされ、まだアプリ経由の予約・来店がないため、過去の来店をきっかけにする自動配信（サンクス・アフターケア・次回提案・リマインダー）はスキップされています。<br/>
                予約や会計が登録されると自動でアクティブになります。手動で「今後の配信対象にする」場合は下のボタンを押してください。
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  const { error } = await supabase
                    .from("customers")
                    .update({ activated_at: new Date().toISOString() } as any)
                    .eq("id", customer.id);
                  setLoading(false);
                  if (error) { toast.error("アクティブ化に失敗しました: " + error.message); return; }
                  toast.success("この顧客をアクティブ化しました");
                  onOpenChange(false);
                  onSaved();
                }}
                className="rounded-none px-4 py-5 text-xs tracking-luxury"
              >
                手動でアクティブ化する
              </Button>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" className="rounded-none px-4 py-6 text-xs tracking-luxury">
                  <Trash2 className="w-3.5 h-3.5 mr-2 stroke-[1.5]" />削除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-none">
                <AlertDialogHeader>
                  <AlertDialogTitle>本当に削除しますか？</AlertDialogTitle>
                  <AlertDialogDescription>
                    {customer?.full_name} さんの顧客データを完全に削除します。この操作は取り消せません。
                    （関連する予約データは残ります）
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-none">キャンセル</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={deleting}
                    className="rounded-none bg-destructive hover:bg-destructive/90">
                    {deleting && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                    削除する
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button type="submit" disabled={loading}
              className="flex-1 rounded-none py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow">
              {loading && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              保存する <span className="ml-2 opacity-60 text-[10px]">SAVE</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditCustomerDialog;
