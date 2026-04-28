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

const schema = z.object({
  full_name: z.string().trim().min(1, "お名前は必須です").max(100),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email("正しいメールアドレス").max(255).optional().or(z.literal("")),
  last_visit_date: z.string().optional(),
  visit_count: z.coerce.number().int().min(0).max(10000).optional(),
  total_spent: z.coerce.number().int().min(0).max(100000000).optional(),
});

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}

const AddCustomerDialog = ({ open, onOpenChange, onAdded }: Props) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", last_visit_date: "", visit_count: "0", total_spent: "0" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setLoading(true);
    const { error } = await supabase.from("customers").insert({
      owner_id: user.id,
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      last_visit_date: parsed.data.last_visit_date || null,
      visit_count: parsed.data.visit_count ?? 0,
      total_spent: parsed.data.total_spent ?? 0,
    });
    setLoading(false);
    if (error) { toast.error("登録に失敗しました"); return; }
    toast.success("顧客を追加しました");
    setForm({ full_name: "", phone: "", email: "", last_visit_date: "", visit_count: "0", total_spent: "0" });
    onOpenChange(false);
    onAdded();
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
            <Label className="eyebrow mb-2 block">Full Name *</Label>
            <Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
              required className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="eyebrow mb-2 block">Phone</Label>
              <Input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="eyebrow mb-2 block">Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="eyebrow mb-2 block">Last Visit</Label>
              <Input type="date" value={form.last_visit_date} onChange={e => setForm({...form, last_visit_date: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="eyebrow mb-2 block">Visits</Label>
              <Input type="number" min={0} value={form.visit_count} onChange={e => setForm({...form, visit_count: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label className="eyebrow mb-2 block">Spent (¥)</Label>
              <Input type="number" min={0} value={form.total_spent} onChange={e => setForm({...form, total_spent: e.target.value})}
                className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
          </div>
          <Button type="submit" disabled={loading}
            className="w-full rounded-none py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow">
            {loading && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
            ADD GUEST
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddCustomerDialog;
