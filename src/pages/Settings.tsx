import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Star, MessageCircle, Bell, FlaskConical, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const Settings = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    salon_name: "",
    google_review_url: "",
    line_add_friend_url: "",
    line_channel_access_token: "",
    owner_notification_email: "",
    test_mode: false,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("salon_name, google_review_url, line_add_friend_url, line_channel_access_token, owner_notification_email, test_mode")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        setForm({
          salon_name: data.salon_name || "",
          google_review_url: data.google_review_url || "",
          line_add_friend_url: data.line_add_friend_url || "",
          line_channel_access_token: data.line_channel_access_token || "",
          owner_notification_email: (data as any).owner_notification_email || "",
          test_mode: (data as any).test_mode || false,
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
        owner_notification_email: form.owner_notification_email.trim() || null,
        test_mode: form.test_mode,
      } as any)
      .eq("id", user.id);
    setSaving(false);
    if (error) { toast.error("保存に失敗しました"); return; }
    toast.success("設定を保存しました");
  };

  const sendTestEmail = async () => {
    if (!form.owner_notification_email.trim()) {
      toast.error("先に通知の宛先メールアドレスを保存してください");
      return;
    }
    setTesting(true);
    const { error } = await supabase.functions.invoke("notify-owner-booking", {
      body: { test: true, recipientEmail: form.owner_notification_email.trim(), salonName: form.salon_name || "あなたのサロン" },
    });
    setTesting(false);
    if (error) { toast.error("テスト送信に失敗しました"); return; }
    toast.success("テストメールを送信しました。受信箱をご確認ください。");
  };

  const deleteTestData = async () => {
    if (!user) return;
    setDeleting(true);
    const { data, error } = await supabase.rpc("delete_test_data" as any, { _owner_id: user.id });
    setDeleting(false);
    if (error || !(data as any)?.success) { toast.error("削除に失敗しました"); return; }
    const d = data as any;
    toast.success(`テストデータを削除しました（予約${d.deleted_bookings}件 / 顧客${d.deleted_customers}件）`);
  };

  if (loading) {
    return <AppLayout><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div></AppLayout>;
  }

  return (
    <AppLayout>
      <PageHeader eyebrow="— Settings —" title="サロン設定" description="Connect your salon to Google & LINE" />

      <div className="max-w-2xl space-y-12">
        <section className="space-y-5">
          <Label className="block font-serif text-sm">サロン名 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Salon Name</span></Label>
          <Input value={form.salon_name} onChange={e => setForm({...form, salon_name: e.target.value})}
            className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
        </section>

        <section className="space-y-5 pt-8 border-t border-border">
          <div className="flex items-center gap-3">
            <Bell className="w-4 h-4 text-gold" />
            <h2 className="display text-xl">予約通知メール</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            新規予約・キャンセルが入った瞬間に、ここで指定したメールアドレスへ即時通知が届きます。
            スマホのメールアプリで受信すれば、予約の見逃しを防げます。
          </p>
          <div>
            <Label className="mb-2 block font-serif text-sm">通知の宛先 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Notification Email</span></Label>
            <Input type="email" value={form.owner_notification_email}
              onChange={e => setForm({...form, owner_notification_email: e.target.value})}
              placeholder="info@arunehair.com"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            <p className="text-[10px] text-muted-foreground mt-2">空欄の場合は通知されません</p>
          </div>
          <Button type="button" onClick={sendTestEmail} disabled={testing} variant="outline"
            className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
            {testing ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
            テスト通知を送信 <span className="ml-2 opacity-60 text-[10px]">TEST EMAIL</span>
          </Button>
          <p className="text-[10px] text-muted-foreground">
            ※ ダミーデータでメール文面のみ送信します。データベースには何も保存されません。
          </p>
        </section>

        <section className="space-y-5 pt-8 border-t border-border">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-4 h-4 text-gold" />
            <h2 className="display text-xl">テストモード</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            ONにすると、公開予約フォームから入った予約・顧客に「テスト」フラグが自動で付与され、<br />
            <strong>ダッシュボードの数字（顧客数・売上・予約数）から完全に除外されます</strong>。<br />
            予約フローの動作確認が終わったら必ずOFFに戻してください。
          </p>
          <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
            <div>
              <div className="font-serif text-sm">テストモード</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {form.test_mode ? "🧪 ON — テスト中の予約は集計から除外されます" : "● OFF — 通常運用中"}
              </div>
            </div>
            <Switch checked={form.test_mode} onCheckedChange={v => setForm({...form, test_mode: v})} />
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline"
                className="rounded-none border-destructive/40 text-destructive text-xs tracking-luxury hover:bg-destructive/5">
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                テストデータを一括削除 <span className="ml-2 opacity-60 text-[10px]">PURGE</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>テストデータをすべて削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  「テスト」フラグの付いた予約・顧客データを完全に削除します。<br />
                  この操作は取り消せません。本番のお客様データには影響しません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={deleteTestData} disabled={deleting}
                  className="bg-destructive hover:bg-destructive/90">
                  {deleting && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                  削除する
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
            <Label className="mb-2 block font-serif text-sm">レビュー投稿URL <span className="eyebrow text-[9px] text-muted-foreground ml-1">Google Review URL</span></Label>
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
            <Label className="mb-2 block font-serif text-sm">LINE 友だち追加URL <span className="eyebrow text-[9px] text-muted-foreground ml-1">Add Friend</span></Label>
            <Input value={form.line_add_friend_url} onChange={e => setForm({...form, line_add_friend_url: e.target.value})}
              placeholder="https://lin.ee/xxxxxx"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">チャネルアクセストークン <span className="eyebrow text-[9px] text-muted-foreground ml-1">Channel Access Token</span></Label>
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
          設定を保存する <span className="ml-2 opacity-60 text-[10px]">SAVE</span>
        </Button>
      </div>
    </AppLayout>
  );
};

export default Settings;
