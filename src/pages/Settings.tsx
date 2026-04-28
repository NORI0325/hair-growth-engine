import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Star, MessageCircle } from "lucide-react";
import { toast } from "sonner";

const Settings = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    salon_name: "",
    google_review_url: "",
    line_add_friend_url: "",
    line_channel_access_token: "",
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("salon_name, google_review_url, line_add_friend_url, line_channel_access_token")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        setForm({
          salon_name: data.salon_name || "",
          google_review_url: data.google_review_url || "",
          line_add_friend_url: data.line_add_friend_url || "",
          line_channel_access_token: data.line_channel_access_token || "",
        });
      }
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        salon_name: form.salon_name || null,
        google_review_url: form.google_review_url.trim() || null,
        line_add_friend_url: form.line_add_friend_url.trim() || null,
        line_channel_access_token: form.line_channel_access_token.trim() || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) { toast.error("保存に失敗しました"); return; }
    toast.success("設定を保存しました");
  };

  if (loading) {
    return <AppLayout><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div></AppLayout>;
  }

  return (
    <AppLayout>
      <PageHeader eyebrow="— Settings —" title="サロン設定" description="Connect your salon to Google & LINE" />

      <div className="max-w-2xl space-y-12">
        <section className="space-y-5">
          <Label className="eyebrow block">Salon Name</Label>
          <Input value={form.salon_name} onChange={e => setForm({...form, salon_name: e.target.value})}
            className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
        </section>

        <section className="space-y-5 pt-8 border-t border-border">
          <div className="flex items-center gap-3">
            <Star className="w-4 h-4 text-gold" />
            <h2 className="display text-xl">Googleレビュー誘導</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            来店3日後、リピーター（2回目以降のお客様）に自動でレビュー依頼を配信します。
            Googleビジネスプロフィールの「クチコミを書く」短縮URL（g.page/r/... 形式）を貼り付けてください。
          </p>
          <div>
            <Label className="eyebrow mb-2 block">Google Review URL</Label>
            <Input value={form.google_review_url} onChange={e => setForm({...form, google_review_url: e.target.value})}
              placeholder="https://g.page/r/..."
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
        </section>

        <section className="space-y-5 pt-8 border-t border-border">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-4 h-4 text-gold" />
            <h2 className="display text-xl">LINE公式アカウント連携</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            LINE Messaging APIのチャネルアクセストークンを設定すると、LINE IDが登録されたお客様にメール/SMSと同時にLINEでも通知できます。
            日本のサロン顧客の反応率が最も高い媒体です。
          </p>
          <div>
            <Label className="eyebrow mb-2 block">LINE 友だち追加URL</Label>
            <Input value={form.line_add_friend_url} onChange={e => setForm({...form, line_add_friend_url: e.target.value})}
              placeholder="https://lin.ee/xxxxxx"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <Label className="eyebrow mb-2 block">Channel Access Token</Label>
            <Input type="password" value={form.line_channel_access_token}
              onChange={e => setForm({...form, line_channel_access_token: e.target.value})}
              placeholder="長期トークン"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            <p className="text-[10px] text-muted-foreground mt-2">
              LINE Developers コンソールのMessaging API設定から取得できます
            </p>
          </div>
        </section>

        <Button onClick={save} disabled={saving}
          className="rounded-none px-12 py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow">
          {saving && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
          SAVE SETTINGS
        </Button>
      </div>
    </AppLayout>
  );
};

export default Settings;
