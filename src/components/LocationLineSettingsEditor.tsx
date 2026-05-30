import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLocation } from "@/hooks/useLocations";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function LocationLineSettingsEditor() {
  const { currentLocation, currentLocationId } = useCurrentLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [usePerLocation, setUsePerLocation] = useState(false);
  const [form, setForm] = useState({
    line_channel_access_token: "",
    line_channel_secret: "",
    line_add_friend_url: "",
    owner_notification_email: "",
  });
  const [settingMenu, setSettingMenu] = useState(false);

  useEffect(() => {
    if (!currentLocationId) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("line_channel_access_token, line_channel_secret, line_add_friend_url, owner_notification_email")
        .eq("id", currentLocationId)
        .maybeSingle();

      if (!active) return;

      if (error) {
        toast.error("店舗別LINE設定の取得に失敗しました");
        setLoading(false);
        return;
      }

      const d = (data || {}) as any;
      const hasLocationLineSettings = Boolean(
        d.line_channel_access_token || d.line_channel_secret || d.line_add_friend_url
      );

      setUsePerLocation(hasLocationLineSettings);
      setForm({
        line_channel_access_token: d.line_channel_access_token || "",
        line_channel_secret: d.line_channel_secret || "",
        line_add_friend_url: d.line_add_friend_url || "",
        owner_notification_email: d.owner_notification_email || "",
      });
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [currentLocationId]);

  const save = async () => {
    if (!currentLocationId) return;

    setSaving(true);
    const payload = usePerLocation
      ? {
          line_channel_access_token: form.line_channel_access_token.trim() || null,
          line_channel_secret: form.line_channel_secret.trim() || null,
          line_add_friend_url: form.line_add_friend_url.trim() || null,
          owner_notification_email: form.owner_notification_email.trim() || null,
        }
      : {
          line_channel_access_token: null,
          line_channel_secret: null,
          line_add_friend_url: null,
        };

    const { error } = await supabase
      .from("locations")
      .update(payload as any)
      .eq("id", currentLocationId);

    setSaving(false);

    if (error) {
      toast.error("保存に失敗しました: " + error.message);
      return;
    }

    toast.success(usePerLocation ? "店舗専用LINE設定を保存しました" : "オーナー共通LINE設定へ戻しました");
  };

  const setupRichMenuForLocation = async () => {
    if (!currentLocationId) return;

    setSettingMenu(true);
    const { data, error } = await supabase.functions.invoke("line-setup-rich-menu", {
      body: { location_id: currentLocationId },
    });
    setSettingMenu(false);

    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "リッチメニュー設定に失敗しました");
      return;
    }

    toast.success(
      `リッチメニュー設定完了（${(data as any).scope === "location" ? "店舗専用" : "オーナー共通"}）`
    );
  };

  if (!currentLocationId) {
    return <p className="text-xs text-muted-foreground">店舗を選択してください。</p>;
  }

  if (loading) return <Loader2 className="w-4 h-4 animate-spin text-gold" />;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 p-3 border border-border bg-secondary/20">
        <div className="space-y-1">
          <Label className="font-serif text-sm flex items-center gap-2">
            <MessageCircle className="w-3.5 h-3.5 text-gold" />
            この店舗専用のLINE公式アカウントを使う
          </Label>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            OFFの場合はオーナー共通のLINE設定を使います。
            <br />
            ONの場合は{currentLocation?.name || "この店舗"}専用のLINEトークンで送受信します。
          </p>
        </div>
        <Switch checked={usePerLocation} onCheckedChange={setUsePerLocation} />
      </div>

      {usePerLocation && (
        <div className="space-y-4 pl-2 border-l-2 border-gold/30">
          <div>
            <Label className="mb-2 block font-serif text-sm">LINE 友だち追加URL（店舗専用）</Label>
            <Input
              value={form.line_add_friend_url}
              onChange={(e) => setForm({ ...form, line_add_friend_url: e.target.value })}
              placeholder="https://lin.ee/xxxxxx"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold"
            />
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">チャネルアクセストークン（店舗専用）</Label>
            <Input
              type="password"
              value={form.line_channel_access_token}
              onChange={(e) => setForm({ ...form, line_channel_access_token: e.target.value })}
              placeholder="長期トークン"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold"
            />
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">チャネルシークレット（店舗専用）</Label>
            <Input
              type="password"
              value={form.line_channel_secret}
              onChange={(e) => setForm({ ...form, line_channel_secret: e.target.value })}
              placeholder="Webhook署名検証に使用"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold"
            />
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">この店舗の通知メール（任意）</Label>
            <Input
              value={form.owner_notification_email}
              onChange={(e) => setForm({ ...form, owner_notification_email: e.target.value })}
              placeholder="store-a@example.com"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          type="button"
          onClick={save}
          disabled={saving}
          variant="outline"
          className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
          店舗別LINE設定を保存
        </Button>
        {usePerLocation && (
          <Button
            type="button"
            onClick={setupRichMenuForLocation}
            disabled={settingMenu}
            variant="outline"
            className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5"
          >
            {settingMenu ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 mr-2" />
            )}
            この店舗のリッチメニューを設定
          </Button>
        )}
      </div>
    </div>
  );
}
