import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenant";
import { useCurrentLocationId } from "@/hooks/useLocations";

const CHANNELS = [
  { key: "salonboard", label: "サロンボード" },
  { key: "rakuten_beauty", label: "楽天ビューティー" },
  { key: "line_reservation", label: "LINE予約" },
  { key: "google_reservation", label: "Google予約" },
];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "staff" | "menu";
  targetId: string | null;
  targetName?: string;
};

export default function ChannelMappingDialog({ open, onOpenChange, kind, targetId, targetName }: Props) {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const table = (kind === "staff" ? "staff_channel_mappings" : "menu_channel_mappings") as any;
  const fk = kind === "staff" ? "staff_id" : "menu_id";
  const [rows, setRows] = useState<Record<string, { external_name: string; external_id: string }>>({});

  useEffect(() => {
    if (!open || !targetId || !tenantId || !locationId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from(table)
        .select("channel, external_name, external_id")
        .eq("owner_id", tenantId)
        .eq("location_id", locationId)
        .eq(fk, targetId);
      const map: Record<string, { external_name: string; external_id: string }> = {};
      for (const c of CHANNELS) map[c.key] = { external_name: "", external_id: "" };
      for (const d of data || []) {
        map[d.channel] = { external_name: d.external_name ?? "", external_id: d.external_id ?? "" };
      }
      setRows(map);
    })();
  }, [open, targetId, tenantId, locationId, table, fk]);

  const save = async () => {
    if (!user || !tenantId || !locationId || !targetId) return;
    const upserts = CHANNELS
      .filter((c) => rows[c.key].external_name || rows[c.key].external_id)
      .map((c) => ({
        owner_id: tenantId,
        location_id: locationId,
        [fk]: targetId,
        channel: c.key,
        external_name: rows[c.key].external_name || null,
        external_id: rows[c.key].external_id || null,
      }));

    const empties = CHANNELS.filter((c) => !rows[c.key].external_name && !rows[c.key].external_id);
    for (const c of empties) {
      await (supabase as any)
        .from(table)
        .delete()
        .eq("owner_id", tenantId)
        .eq("location_id", locationId)
        .eq(fk, targetId)
        .eq("channel", c.key);
    }

    if (upserts.length > 0) {
      const { error } = await (supabase as any).from(table).upsert(upserts, { onConflict: `${fk},channel` });
      if (error) { toast.error("保存失敗: " + error.message); return; }
    }
    toast.success("マッピングを保存しました");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif">媒体別の名称マッピング {targetName && <span className="text-sm text-muted-foreground">— {targetName}</span>}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">外部媒体側に登録されている{kind === "staff" ? "スタッフ名" : "メニュー名"}を入力してください。空欄にすると同期時に対応マッピングなしと判定されます。</p>
          {CHANNELS.map((c) => (
            <div key={c.key} className="grid grid-cols-[120px_1fr_140px] gap-3 items-center">
              <Label className="text-sm">{c.label}</Label>
              <Input
                placeholder="外部媒体での表示名"
                value={rows[c.key]?.external_name ?? ""}
                onChange={(e) => setRows({ ...rows, [c.key]: { ...rows[c.key], external_name: e.target.value } })}
                className="rounded-none"
              />
              <Input
                placeholder="ID（任意）"
                value={rows[c.key]?.external_id ?? ""}
                onChange={(e) => setRows({ ...rows, [c.key]: { ...rows[c.key], external_id: e.target.value } })}
                className="rounded-none"
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-none" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button className="rounded-none" onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
