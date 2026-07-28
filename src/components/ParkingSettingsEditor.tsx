import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Car } from "lucide-react";
import { toast } from "sonner";

type ParkingStatus = "available" | "partner" | "none" | "unknown";

interface Form {
  parking_status: ParkingStatus;
  parking_spaces: string;
  parking_description: string;
  parking_map_url: string;
  parking_landmark: string;
  parking_full_notice: string;
  parking_fee_note: string;
  parking_photo_url: string;
  parking_reply_template: string;
}

const empty: Form = {
  parking_status: "unknown",
  parking_spaces: "",
  parking_description: "",
  parking_map_url: "",
  parking_landmark: "",
  parking_full_notice: "",
  parking_fee_note: "",
  parking_photo_url: "",
  parking_reply_template: "",
};

export default function ParkingSettingsEditor() {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [form, setForm] = useState<Form>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rowId, setRowId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!user || !tenantId) return;
      setLoading(true);
      let q = supabase
        .from("salon_parking_settings")
        .select("*")
        .eq("owner_id", tenantId);
      q = locationId ? q.eq("location_id", locationId) : q.is("location_id", null);
      const { data } = await q.maybeSingle();
      if (data) {
        setRowId(data.id);
        setForm({
          parking_status: (data.parking_status as ParkingStatus) ?? "unknown",
          parking_spaces: data.parking_spaces?.toString() ?? "",
          parking_description: data.parking_description ?? "",
          parking_map_url: data.parking_map_url ?? "",
          parking_landmark: data.parking_landmark ?? "",
          parking_full_notice: data.parking_full_notice ?? "",
          parking_fee_note: data.parking_fee_note ?? "",
          parking_photo_url: data.parking_photo_url ?? "",
          parking_reply_template: data.parking_reply_template ?? "",
        });
      } else {
        setRowId(null);
        setForm(empty);
      }
      setLoading(false);
    })();
  }, [user, tenantId, locationId]);

  const save = async () => {
    if (!user || !tenantId) return;
    setSaving(true);
    const payload: any = {
      owner_id: tenantId,
      location_id: locationId ?? null,
      parking_status: form.parking_status,
      parking_spaces: form.parking_spaces ? Number(form.parking_spaces) : null,
      parking_description: form.parking_description || null,
      parking_map_url: form.parking_map_url || null,
      parking_landmark: form.parking_landmark || null,
      parking_full_notice: form.parking_full_notice || null,
      parking_fee_note: form.parking_fee_note || null,
      parking_photo_url: form.parking_photo_url || null,
      parking_reply_template: form.parking_reply_template || null,
    };
    const { error } = rowId
      ? await supabase.from("salon_parking_settings").update(payload).eq("id", rowId)
      : await supabase.from("salon_parking_settings").insert(payload);
    setSaving(false);
    if (error) toast.error("保存に失敗: " + error.message);
    else toast.success("駐車場設定を保存しました");
  };

  if (loading) return <div className="text-sm text-muted-foreground">読み込み中…</div>;

  const status = form.parking_status;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Car className="w-4 h-4 text-gold" />
        <h3 className="font-serif text-lg">アクセス・駐車場設定</h3>
        <span className="eyebrow text-[9px] text-muted-foreground ml-1">Parking & Access</span>
      </div>
      <p className="text-xs text-muted-foreground">
        LINEで「駐車場」を押されたお客様へ、ここに登録した内容が自動返信されます。
      </p>

      <div>
        <Label className="block font-serif text-sm mb-2">駐車場の状況</Label>
        <Select value={status} onValueChange={(v) => setForm({ ...form, parking_status: v as ParkingStatus })}>
          <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="available">専用駐車場あり</SelectItem>
            <SelectItem value="partner">提携駐車場あり</SelectItem>
            <SelectItem value="none">専用駐車場なし（近隣コインパーキング）</SelectItem>
            <SelectItem value="unknown">未設定</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {status === "available" && (
        <div>
          <Label className="block font-serif text-sm mb-2">駐車可能台数</Label>
          <Input type="number" min={0} value={form.parking_spaces} onChange={(e) => setForm({ ...form, parking_spaces: e.target.value })}
            className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" placeholder="例: 3" />
        </div>
      )}

      <div>
        <Label className="block font-serif text-sm mb-2">駐車場の説明</Label>
        <Textarea rows={3} value={form.parking_description} onChange={(e) => setForm({ ...form, parking_description: e.target.value })}
          placeholder="例: 店舗右横にございます。番号3番が当店専用です。" />
      </div>

      {status === "available" && (
        <>
          <div>
            <Label className="block font-serif text-sm mb-2">目印</Label>
            <Input value={form.parking_landmark} onChange={(e) => setForm({ ...form, parking_landmark: e.target.value })}
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" placeholder="例: 青い看板の隣" />
          </div>
          <div>
            <Label className="block font-serif text-sm mb-2">満車時のご案内</Label>
            <Textarea rows={2} value={form.parking_full_notice} onChange={(e) => setForm({ ...form, parking_full_notice: e.target.value })}
              placeholder="例: お手数ですが、店舗から徒歩2分の◯◯コインパーキングをご利用ください。" />
          </div>
        </>
      )}

      {status === "partner" && (
        <div>
          <Label className="block font-serif text-sm mb-2">駐車料金・サービス券のご案内</Label>
          <Textarea rows={2} value={form.parking_fee_note} onChange={(e) => setForm({ ...form, parking_fee_note: e.target.value })}
            placeholder="例: ご来店のお客様には1時間分のサービス券をお渡ししております。" />
        </div>
      )}

      <div>
        <Label className="block font-serif text-sm mb-2">GoogleマップURL</Label>
        <Input value={form.parking_map_url} onChange={(e) => setForm({ ...form, parking_map_url: e.target.value })}
          className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" placeholder="https://maps.google.com/..." />
      </div>

      <div>
        <Label className="block font-serif text-sm mb-2">駐車場写真URL（任意）</Label>
        <Input value={form.parking_photo_url} onChange={(e) => setForm({ ...form, parking_photo_url: e.target.value })}
          className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
      </div>

      <div>
        <Label className="block font-serif text-sm mb-2">LINE返信テンプレート（任意・上書き）</Label>
        <Textarea rows={5} value={form.parking_reply_template} onChange={(e) => setForm({ ...form, parking_reply_template: e.target.value })}
          placeholder="入力すると、自動生成文面の代わりにこちらが送信されます。" />
      </div>

      <Button onClick={save} disabled={saving} className="rounded-none">
        {saving ? "保存中…" : "保存する"}
      </Button>
    </div>
  );
}
