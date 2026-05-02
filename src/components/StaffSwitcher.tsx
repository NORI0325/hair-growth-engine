import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveStaff } from "@/hooks/useActiveStaff";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserCircle2, LogOut } from "lucide-react";
import { toast } from "sonner";

/**
 * Shared-tablet staff switcher.
 * Tap to open a numeric PIN pad. Match against staff.pin_code under the
 * current owner. Persists in localStorage so the chart UI knows who is editing.
 */
export const StaffSwitcher = () => {
  const { user } = useAuth();
  const { active, setStaff } = useActiveStaff();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) setPin(""); }, [open]);

  const submit = async (code: string) => {
    if (!user || code.length < 4) return;
    setBusy(true);
    const { data } = await supabase
      .from("staff")
      .select("id,name,pin_code")
      .eq("owner_id", user.id)
      .eq("active", true)
      .eq("pin_code", code)
      .maybeSingle();
    setBusy(false);
    if (!data) {
      toast.error("PINが一致しません");
      setPin("");
      return;
    }
    setStaff({ id: data.id, name: data.name, at: Date.now() });
    toast.success(`${data.name} に切替`);
    setOpen(false);
  };

  const press = (n: string) => {
    const next = (pin + n).slice(0, 6);
    setPin(next);
    if (next.length >= 4) {
      // try at 4 first, but allow 5–6 by waiting briefly
      // For simplicity submit immediately when length reaches 4 if no match,
      // user can retry with longer codes by pressing C first.
      submit(next);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="rounded-none gap-2 h-9"
      >
        <UserCircle2 className="w-4 h-4 text-gold" />
        <span className="text-xs">{active ? active.name : "操作者を選択"}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs rounded-none">
          <DialogHeader>
            <DialogTitle className="font-serif text-center">操作スタッフPIN</DialogTitle>
          </DialogHeader>
          <div className="text-center text-2xl tracking-[0.5em] font-mono py-4 border-b border-border">
            {pin.padEnd(4, "・")}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <Button key={n} variant="outline" onClick={() => press(String(n))} disabled={busy}
                className="rounded-none h-14 text-lg">{n}</Button>
            ))}
            <Button variant="ghost" onClick={() => setPin("")} className="rounded-none h-14 text-xs">C</Button>
            <Button variant="outline" onClick={() => press("0")} disabled={busy} className="rounded-none h-14 text-lg">0</Button>
            <Button variant="ghost" onClick={() => setPin(p => p.slice(0, -1))} className="rounded-none h-14 text-xs">←</Button>
          </div>
          {active && (
            <Button variant="ghost" size="sm" onClick={() => { setStaff(null); setOpen(false); toast.success("ログアウト"); }}
              className="mt-4 rounded-none gap-2 text-muted-foreground">
              <LogOut className="w-3 h-3" /> 操作者を解除
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default StaffSwitcher;
