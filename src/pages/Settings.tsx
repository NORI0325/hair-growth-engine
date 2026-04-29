import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Star, MessageCircle, Bell, FlaskConical, Send, Trash2, Sparkles, Clock, RefreshCw, Copy, Mail, Inbox, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const WEBHOOK_URL = "https://miyedioemkzhetphjzzg.supabase.co/functions/v1/line-webhook";

const Settings = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingLine, setTestingLine] = useState(false);
  const [settingMenu, setSettingMenu] = useState(false);
  const [runningReactivation, setRunningReactivation] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lineTestUserId, setLineTestUserId] = useState("");
  const [inboundKey, setInboundKey] = useState<string>("");
  const [recentImports, setRecentImports] = useState<any[]>([]);
  const [form, setForm] = useState({
    salon_name: "",
    google_review_url: "",
    line_add_friend_url: "",
    line_channel_access_token: "",
    line_channel_secret: "",
    owner_notification_email: "",
    test_mode: false,
    reminder_enabled: true,
    reactivation_enabled: true,
    reminder_hour: 19,
    booking_lead_time_hours: 24,
    booking_max_days_ahead: 60,
    allow_customer_cancel: true,
    cancel_deadline_hours: 3,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("salon_name, google_review_url, line_add_friend_url, line_channel_access_token, line_channel_secret, owner_notification_email, test_mode, reminder_enabled, reactivation_enabled, reminder_hour, inbound_key, booking_lead_time_hours, booking_max_days_ahead, allow_customer_cancel, cancel_deadline_hours")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        setInboundKey((data as any).inbound_key || "");
        // 直近10件の取込履歴
        const { data: logs } = await supabase
          .from("external_reservation_logs")
          .select("source, status, created_at, error, parsed_data")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);
        if (logs) setRecentImports(logs);
      }
      if (data) {
        const d = data as any;
        setForm({
          salon_name: d.salon_name || "",
          google_review_url: d.google_review_url || "",
          line_add_friend_url: d.line_add_friend_url || "",
          line_channel_access_token: d.line_channel_access_token || "",
          line_channel_secret: d.line_channel_secret || "",
          owner_notification_email: d.owner_notification_email || "",
          test_mode: d.test_mode || false,
          reminder_enabled: d.reminder_enabled ?? true,
          reactivation_enabled: d.reactivation_enabled ?? true,
          reminder_hour: d.reminder_hour ?? 19,
          booking_lead_time_hours: d.booking_lead_time_hours ?? 24,
          booking_max_days_ahead: d.booking_max_days_ahead ?? 60,
          allow_customer_cancel: d.allow_customer_cancel ?? true,
          cancel_deadline_hours: d.cancel_deadline_hours ?? 3,
        });
      }
      setLoading(false);
    })();
  }, [user]);


  const toggleTestMode = async (v: boolean) => {
    if (!user) return;
    setForm({ ...form, test_mode: v });
    const { error } = await supabase
      .from("profiles")
      .update({ test_mode: v } as any)
      .eq("id", user.id);
    if (error) {
      setForm({ ...form, test_mode: !v });
      toast.error("テストモードの切替に失敗しました");
      return;
    }
    toast.success(v ? "🧪 テストモードをONにしました" : "テストモードをOFFにしました");
  };

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
        line_channel_secret: form.line_channel_secret.trim() || null,
        owner_notification_email: form.owner_notification_email.trim() || null,
        test_mode: form.test_mode,
        reminder_enabled: form.reminder_enabled,
        reactivation_enabled: form.reactivation_enabled,
        reminder_hour: form.reminder_hour,
      } as any)
      .eq("id", user.id);
    setSaving(false);
    if (error) { toast.error("保存に失敗しました"); return; }
    toast.success("設定を保存しました");
  };

  const setupRichMenu = async () => {
    setSettingMenu(true);
    const { data, error } = await supabase.functions.invoke("line-setup-rich-menu", { body: {} });
    setSettingMenu(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "リッチメニュー設定に失敗しました");
      return;
    }
    toast.success("✅ リッチメニュー（予約/特典/お問合せ）を設定しました。LINEを開いて確認してください。");
  };

  const runReactivation = async () => {
    setRunningReactivation(true);
    const { data, error } = await supabase.functions.invoke("create-reactivation-jobs", { body: {} });
    setRunningReactivation(false);
    if (error) { toast.error("実行に失敗しました"); return; }
    const n = (data as any)?.created ?? 0;
    toast.success(n > 0 ? `${n}名の離脱客に復活ステップを登録しました` : "対象の離脱客は今のところいません ✨");
  };

  const copyWebhook = async () => {
    await navigator.clipboard.writeText(WEBHOOK_URL);
    toast.success("Webhook URLをコピーしました");
  };


  const sendLineTest = async () => {
    if (!form.line_channel_access_token.trim()) {
      toast.error("先にチャネルアクセストークンを保存してください");
      return;
    }
    if (!lineTestUserId.trim()) {
      toast.error("送信先のLINE UserIDを入力してください");
      return;
    }
    setTestingLine(true);
    const { data, error } = await supabase.functions.invoke("line-test-push", {
      body: { lineUserId: lineTestUserId.trim() },
    });
    setTestingLine(false);
    if (error || !(data as any)?.success) {
      const msg = (data as any)?.message || error?.message || "送信に失敗しました";
      toast.error(msg);
      return;
    }
    toast.success("✅ LINEへテスト送信しました。トークを確認してください。");
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
            <Switch checked={form.test_mode} onCheckedChange={toggleTestMode} />
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
            LINE公式アカウントを連携すると、<strong>LINE登録済みのお客様にはLINEのみ</strong>、未登録のお客様にはメールのみが届く設計です（重複しません）。
            日本のサロン顧客の反応率が最も高い媒体です。
          </p>
          <div className="bg-secondary/30 p-4 border border-border space-y-2 text-[11px] text-muted-foreground leading-relaxed">
            <div className="font-serif text-foreground text-xs mb-1">📋 セットアップ手順</div>
            <ol className="list-decimal list-inside space-y-1">
              <li>LINE Developers コンソール → Messaging API設定</li>
              <li>「チャネルアクセストークン（長期）」を発行 → 下に貼り付け</li>
              <li>「チャネル基本設定」→「チャネルシークレット」をコピー → 下に貼り付け</li>
              <li>
                Webhook URLに次を設定（コピーして貼り付け）：
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-[10px] text-gold break-all flex-1">{WEBHOOK_URL}</code>
                  <button type="button" onClick={copyWebhook} className="text-gold hover:text-gold/70" aria-label="copy">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </li>
              <li>「Webhookの利用」をオン、「応答メッセージ」「あいさつメッセージ」をオフ</li>
            </ol>
          </div>
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
          </div>
          <div>
            <Label className="mb-2 block font-serif text-sm">チャネルシークレット <span className="eyebrow text-[9px] text-muted-foreground ml-1">Channel Secret</span></Label>
            <Input type="password" value={form.line_channel_secret}
              onChange={e => setForm({...form, line_channel_secret: e.target.value})}
              placeholder="Webhook署名検証に使用します"
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            <p className="text-[10px] text-muted-foreground mt-2">
              友だち追加→電話番号返信での自動連携に必須です
            </p>
          </div>

          <div className="pt-4 border-t border-border/50 space-y-3">
            <Label className="block font-serif text-sm">🧪 LINEテスト送信 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Test Push</span></Label>
            <p className="text-[10px] text-muted-foreground">
              ご自身のLINE UserID（U で始まる33文字）を入力してテスト送信できます。<br/>
              ※ LINE Developers コンソール「Messaging API設定」→「Webhook URL」下の「Bot basic ID」とは別物です。「Your user ID」と書かれた箇所、または公式アカウントを友だち追加後にWebhookで受信して確認してください。
            </p>
            <Input value={lineTestUserId} onChange={e => setLineTestUserId(e.target.value)}
              placeholder="U1234567890abcdef..."
              className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold font-mono text-xs" />
            <Button type="button" onClick={sendLineTest} disabled={testingLine} variant="outline"
              className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
              {testingLine ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
              LINEへテスト送信 <span className="ml-2 opacity-60 text-[10px]">TEST LINE</span>
            </Button>
          </div>
        </section>

        <section className="space-y-5 pt-8 border-t border-border">
          <div className="flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-gold" />
            <h2 className="display text-xl">LINE自動配信</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            日本一のサロンが必ずやっている「来店前日リマインド」「離脱客の復活」を自動化します。
            LINE登録済みのお客様にのみ送信されます（メールには送らないので、うっとうしさゼロ）。
          </p>

          <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-gold mt-0.5" />
              <div>
                <div className="font-serif text-sm">来店前日リマインド</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  予約日の前日{form.reminder_hour}時に「明日お待ちしています」を自動配信。無断キャンセル激減。
                </div>
              </div>
            </div>
            <Switch checked={form.reminder_enabled}
              onCheckedChange={v => setForm({...form, reminder_enabled: v})} />
          </div>
          {form.reminder_enabled && (
            <div className="pl-8">
              <Label className="block font-serif text-xs mb-2">配信時刻</Label>
              <select value={form.reminder_hour}
                onChange={e => setForm({...form, reminder_hour: parseInt(e.target.value)})}
                className="bg-background border border-border px-3 py-1.5 text-xs rounded-none focus:outline-none focus:border-gold">
                {[10,11,12,13,14,15,16,17,18,19,20,21].map(h => (
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-2">推奨：18〜20時（仕事帰りで一番開封されやすい時間帯）</p>
            </div>
          )}

          <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
            <div className="flex items-start gap-3">
              <RefreshCw className="w-4 h-4 text-gold mt-0.5" />
              <div>
                <div className="font-serif text-sm">離脱客の自動復活ステップ</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  最終来店から90〜120日経ったお客様に「20%OFF復活クーポン」を自動配信。
                </div>
              </div>
            </div>
            <Switch checked={form.reactivation_enabled}
              onCheckedChange={v => setForm({...form, reactivation_enabled: v})} />
          </div>

          <Button type="button" onClick={runReactivation} disabled={runningReactivation} variant="outline"
            className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
            {runningReactivation ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
            離脱客を今すぐ抽出して送信予約 <span className="ml-2 opacity-60 text-[10px]">RUN NOW</span>
          </Button>
          <p className="text-[10px] text-muted-foreground">
            ※ 通常は毎日自動で実行されます（保存後に有効化）。今すぐ動作確認したいときに使ってください。
          </p>

          <div className="pt-6 border-t border-border/50 space-y-3">
            <Label className="block font-serif text-sm">📱 リッチメニュー一発設定 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Rich Menu</span></Label>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              LINEトーク画面の下に常設される「予約 / 特典 / お問合せ」3ボタンメニューを自動セットアップします。
              友だち追加した瞬間から、お客様がワンタップで予約できる導線が完成します。
            </p>
            <Button type="button" onClick={setupRichMenu} disabled={settingMenu} variant="outline"
              className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
              {settingMenu ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
              リッチメニューを設定する <span className="ml-2 opacity-60 text-[10px]">SETUP</span>
            </Button>
            <p className="text-[10px] text-muted-foreground">
              ※ チャネルアクセストークンの保存と、サロン公開URLが必要です。
            </p>
          </div>
        </section>

        {/* 外部予約サイト連携（ホットペッパー / minimo / 楽天Beauty） */}
        <section className="space-y-6 p-8 border border-border bg-card">
          <div>
            <p className="eyebrow mb-2 text-gold">— External Reservations —</p>
            <h3 className="display text-lg flex items-center gap-2">
              <Inbox className="w-4 h-4 text-gold" /> 外部予約サイト自動連携
            </h3>
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              ホットペッパー / minimo / 楽天Beautyの予約通知メールを、店舗のメールから下記アドレスに「自動転送」設定するだけで、
              予約・顧客がリアルタイムにこのアプリに自動登録されます。リマインダー・サンクス・LINE通知も自動発火します。
            </p>
          </div>

          {[
            { code: "hp", label: "ホットペッパービューティー", color: "text-orange-400" },
            { code: "mn", label: "minimo（ミニモ）", color: "text-pink-400" },
            { code: "rb", label: "楽天ビューティ", color: "text-red-400" },
          ].map(site => {
            const addr = inboundKey ? `${site.code}-${inboundKey}@inbound.arunehair.com` : "（保存後に発行されます）";
            return (
              <div key={site.code} className="border border-border/50 p-4 bg-secondary/10">
                <div className={`font-serif text-sm ${site.color} mb-2`}>{site.label}</div>
                <div className="flex items-center gap-2">
                  <Input value={addr} readOnly
                    className="rounded-none border-x-0 border-t-0 px-0 text-xs font-mono bg-transparent" />
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => { navigator.clipboard.writeText(addr); toast.success("コピーしました"); }}
                    disabled={!inboundKey}
                    className="rounded-none border-gold/40 text-[10px] tracking-luxury">
                    <Copy className="w-3 h-3 mr-1" /> COPY
                  </Button>
                </div>
              </div>
            );
          })}

          <details className="border border-border/40 p-4 bg-secondary/5">
            <summary className="cursor-pointer font-serif text-sm flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-gold" /> 設定手順を見る（Gmailの場合）
            </summary>
            <ol className="mt-4 text-[11px] text-muted-foreground space-y-2 leading-relaxed list-decimal list-inside">
              <li>店舗のGmailを開き、右上の歯車 → 「すべての設定を表示」</li>
              <li>「メール転送と POP/IMAP」タブ → 「転送先アドレスを追加」</li>
              <li>上記の専用アドレスを貼り付け → 確認メールに記載のコードを承認</li>
              <li>「フィルタとブロック中のアドレス」→「新しいフィルタを作成」</li>
              <li>「From」欄に各サイトのアドレスを入力（例: ホットペッパー→ <code>hotpepper-beauty@beauty.hotpepper.jp</code>）</li>
              <li>「次のアドレスに転送する」を選択 → 専用アドレスを指定 → 完了</li>
            </ol>
            <p className="mt-3 text-[10px] text-amber-400/80">
              ⚠️ Resend Inbound Webhookの設定が完了するまで取込は動きません（Lovable側で設定要）
            </p>
          </details>

          <div className="pt-4 border-t border-border/30">
            <div className="font-serif text-sm mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-gold" /> 直近の取込履歴（最大10件）
            </div>
            {recentImports.length === 0 ? (
              <p className="text-[10px] text-muted-foreground italic">まだ取込履歴はありません</p>
            ) : (
              <div className="space-y-1.5">
                {recentImports.map((log, i) => {
                  const Icon = log.status === "created" ? CheckCircle2
                    : log.status === "duplicate" ? AlertCircle
                    : log.status === "skipped" ? AlertCircle
                    : XCircle;
                  const color = log.status === "created" ? "text-emerald-400"
                    : log.status === "failed" ? "text-red-400"
                    : "text-amber-400";
                  return (
                    <div key={i} className="flex items-start gap-2 text-[11px] py-1.5 border-b border-border/20">
                      <Icon className={`w-3 h-3 mt-0.5 ${color} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{log.source}</span>
                          <span className={color}>{log.status}</span>
                          <span className="text-muted-foreground/60 text-[9px] ml-auto">
                            {new Date(log.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {log.parsed_data?.customer_name && (
                          <div className="text-muted-foreground/80 truncate">
                            {log.parsed_data.customer_name} / {log.parsed_data.booking_date} {log.parsed_data.booking_time} / {log.parsed_data.menu}
                          </div>
                        )}
                        {log.error && <div className="text-red-400/80 text-[10px] truncate">{log.error}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
