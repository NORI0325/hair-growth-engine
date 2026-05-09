import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Star, MessageCircle, Bell, FlaskConical, Send, Trash2, Sparkles, Clock, RefreshCw, Copy, Mail, Inbox, CheckCircle2, XCircle, AlertCircle, Store, Cake } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import HolidayNoticeBroadcast from "@/components/HolidayNoticeBroadcast";
import SalonHoursEditor from "@/components/SalonHoursEditor";
import ParkingSettingsEditor from "@/components/ParkingSettingsEditor";
import ReactivationStagesEditor, { type ReactivationStage } from "@/components/ReactivationStagesEditor";
import NotificationRecipientsBadge from "@/components/NotificationRecipientsBadge";
import LocationLineSettingsEditor from "@/components/LocationLineSettingsEditor";

const WEBHOOK_URL = "https://miyedioemkzhetphjzzg.supabase.co/functions/v1/line-webhook";

const DEFAULT_STAGES: ReactivationStage[] = [
  { days: 30, discount_percent: 10, label: "お久しぶり" },
  { days: 60, discount_percent: 15, label: "そろそろ" },
  { days: 90, discount_percent: 20, label: "おかえりなさい" },
  { days: 150, discount_percent: 30, label: "特別ご招待" },
];

const Settings = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "store";
  const highlightSection = searchParams.get("section");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingLine, setTestingLine] = useState(false);
  const [settingMenu, setSettingMenu] = useState(false);
  const [runningReactivation, setRunningReactivation] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lineTestUserId, setLineTestUserId] = useState("");
  const [smsTestPhone, setSmsTestPhone] = useState("");
  const [testingSms, setTestingSms] = useState(false);
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
    auto_reply_enabled: false,
    auto_reply_use_ai: true,
    auto_reply_message: "",
    reactivation_stages: DEFAULT_STAGES,
    birthday_enabled: true,
    birthday_discount_percent: 30,
    thank_you_delay_days: 1,
    aftercare_delay_days: 7,
    import_quiet_days: 7,
    approval_mode: "auto" as "auto" | "semi_auto" | "per_template",
    approval_required_templates: [] as string[],
    frequency_cap_days: 7,
    frequency_cap_per_month: 4,
    notification_recipients: [] as { name: string; email: string; line_user_id: string; channels: string[] }[],
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        const d = data as any;
        setInboundKey(d.inbound_key || "");
        const { data: logs } = await supabase
          .from("external_reservation_logs")
          .select("source, status, created_at, error, parsed_data")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);
        if (logs) setRecentImports(logs);
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
          auto_reply_enabled: d.auto_reply_enabled ?? false,
          auto_reply_use_ai: d.auto_reply_use_ai ?? true,
          auto_reply_message: d.auto_reply_message || "",
          reactivation_stages: Array.isArray(d.reactivation_stages) && d.reactivation_stages.length > 0
            ? d.reactivation_stages : DEFAULT_STAGES,
          birthday_enabled: d.birthday_enabled ?? true,
          birthday_discount_percent: d.birthday_discount_percent ?? 30,
          thank_you_delay_days: d.thank_you_delay_days ?? 1,
          aftercare_delay_days: d.aftercare_delay_days ?? 7,
          import_quiet_days: d.import_quiet_days ?? 7,
          approval_mode: (d.approval_mode as any) ?? "auto",
          approval_required_templates: Array.isArray(d.approval_required_templates) ? d.approval_required_templates : [],
          frequency_cap_days: d.frequency_cap_days ?? 7,
          frequency_cap_per_month: d.frequency_cap_per_month ?? 4,
          notification_recipients: Array.isArray((d as any).notification_recipients)
            ? (d as any).notification_recipients.map((r: any) => ({
                name: r.name ?? "",
                email: r.email ?? "",
                line_user_id: r.line_user_id ?? "",
                channels: Array.isArray(r.channels) && r.channels.length ? r.channels : ["email"],
              }))
            : [],
        });
      }
      setLoading(false);
    })();
  }, [user]);

  const toggleTestMode = async (v: boolean) => {
    if (!user) return;
    setForm({ ...form, test_mode: v });
    const { error } = await supabase.from("profiles").update({ test_mode: v } as any).eq("id", user.id);
    if (error) {
      setForm({ ...form, test_mode: !v });
      toast.error("テストモードの切替に失敗しました");
      return;
    }
    toast.success(v ? "🧪 テストモードをONにしました" : "テストモードをOFFにしました");
  };

  const save = async () => {
    if (!user) return;
    if (!form.reactivation_stages || form.reactivation_stages.length === 0) {
      toast.error("離脱客ステップは最低1段階必要です");
      return;
    }
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
        booking_lead_time_hours: form.booking_lead_time_hours,
        booking_max_days_ahead: form.booking_max_days_ahead,
        allow_customer_cancel: form.allow_customer_cancel,
        cancel_deadline_hours: form.cancel_deadline_hours,
        auto_reply_enabled: form.auto_reply_enabled,
        auto_reply_use_ai: form.auto_reply_use_ai,
        auto_reply_message: form.auto_reply_message.trim() || null,
        reactivation_stages: form.reactivation_stages,
        birthday_enabled: form.birthday_enabled,
        birthday_discount_percent: form.birthday_discount_percent,
        thank_you_delay_days: form.thank_you_delay_days,
        aftercare_delay_days: form.aftercare_delay_days,
        import_quiet_days: form.import_quiet_days,
        approval_mode: form.approval_mode,
        approval_required_templates: form.approval_required_templates,
        frequency_cap_days: form.frequency_cap_days,
        frequency_cap_per_month: form.frequency_cap_per_month,
        notification_recipients: (form.notification_recipients || [])
          .filter((r) => (r.email && r.email.trim()) || (r.line_user_id && r.line_user_id.trim()))
          .map((r) => ({
            name: r.name?.trim() || null,
            email: r.email?.trim() || null,
            line_user_id: r.line_user_id?.trim() || null,
            channels: r.channels?.length ? r.channels : ["email"],
          })),
      } as any)
      .eq("id", user.id);
    if (error) {
      setSaving(false);
      toast.error("保存に失敗しました");
      return;
    }
    // 段階削除時の未送信ジョブクリーンアップ
    const { data: cancelled } = await supabase.rpc("cancel_orphan_reactivation_jobs" as any, { _owner_id: user.id });
    setSaving(false);
    if (cancelled && Number(cancelled) > 0) {
      toast.success(`設定を保存しました（削除した段階の未送信ジョブ${cancelled}件もキャンセル）`);
    } else {
      toast.success("設定を保存しました");
    }
  };

  const setupRichMenu = async () => {
    setSettingMenu(true);
    const { data, error } = await supabase.functions.invoke("line-setup-rich-menu", { body: {} });
    setSettingMenu(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "リッチメニュー設定に失敗しました");
      return;
    }
    toast.success("✅ リッチメニュー（予約/特典/お問合せ）を設定しました。");
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
    if (!form.line_channel_access_token.trim()) { toast.error("先にチャネルアクセストークンを保存してください"); return; }
    if (!lineTestUserId.trim()) { toast.error("送信先のLINE UserIDを入力してください"); return; }
    setTestingLine(true);
    const { data, error } = await supabase.functions.invoke("line-test-push", { body: { lineUserId: lineTestUserId.trim() } });
    setTestingLine(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "送信に失敗しました");
      return;
    }
    toast.success("✅ LINEへテスト送信しました。");
  };

  const sendSmsTest = async () => {
    if (!smsTestPhone.trim()) { toast.error("送信先の携帯番号を入力してください"); return; }
    setTestingSms(true);
    const { data, error } = await supabase.functions.invoke("sms-test-send", { body: { phone: smsTestPhone.trim() } });
    setTestingSms(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "送信に失敗しました", { duration: 8000 });
      return;
    }
    toast.success(`✅ SMSをテスト送信しました（${(data as any)?.to}）`);
  };

  const sendTestEmail = async () => {
    if (!form.owner_notification_email.trim()) { toast.error("先に通知の宛先メールアドレスを保存してください"); return; }
    setTesting(true);
    const { error } = await supabase.functions.invoke("notify-owner-booking", {
      body: { test: true, recipientEmail: form.owner_notification_email.trim(), salonName: form.salon_name || "あなたのサロン" },
    });
    setTesting(false);
    if (error) { toast.error("テスト送信に失敗しました"); return; }
    toast.success("テストメールを送信しました。");
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

  const SectionTitle = ({ icon: Icon, title, desc }: { icon: any; title: string; desc?: string }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Icon className="w-4 h-4 text-gold" />
        <h2 className="display text-xl">{title}</h2>
      </div>
      {desc && <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>}
    </div>
  );

  return (
    <AppLayout>
      <PageHeader eyebrow="— Settings —" title="サロン設定" description="店舗・配信・連携をすべて管理" />

      <div className="max-w-3xl">
        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5 rounded-none bg-secondary/30 mb-8">
            <TabsTrigger value="store" className="rounded-none text-xs tracking-luxury data-[state=active]:bg-background data-[state=active]:text-gold">
              <Store className="w-3.5 h-3.5 mr-1.5" />店舗
            </TabsTrigger>
            <TabsTrigger value="messaging" className="rounded-none text-xs tracking-luxury data-[state=active]:bg-background data-[state=active]:text-gold">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />配信
            </TabsTrigger>
            <TabsTrigger value="notify" className="rounded-none text-xs tracking-luxury data-[state=active]:bg-background data-[state=active]:text-gold">
              <Bell className="w-3.5 h-3.5 mr-1.5" />通知
            </TabsTrigger>
            <TabsTrigger value="connect" className="rounded-none text-xs tracking-luxury data-[state=active]:bg-background data-[state=active]:text-gold">
              <MessageCircle className="w-3.5 h-3.5 mr-1.5" />連携
            </TabsTrigger>
            <TabsTrigger value="dev" className="rounded-none text-xs tracking-luxury data-[state=active]:bg-background data-[state=active]:text-gold">
              <FlaskConical className="w-3.5 h-3.5 mr-1.5" />開発
            </TabsTrigger>
          </TabsList>

          {/* ========== 🏪 店舗基本情報 ========== */}
          <TabsContent value="store" className="space-y-12">
            <section className="space-y-5">
              <SectionTitle icon={Store} title="サロン基本情報" />
              <div>
                <Label className="block font-serif text-sm mb-2">サロン名 <span className="eyebrow text-[9px] text-muted-foreground ml-1">Salon Name</span></Label>
                <Input value={form.salon_name} onChange={e => setForm({...form, salon_name: e.target.value})}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
              </div>
            </section>

            <section className="pt-6 border-t border-border">
              <SalonHoursEditor />
            </section>

            <section className="pt-6 border-t border-border">
              <ParkingSettingsEditor />
            </section>

            <section className="space-y-5 pt-6 border-t border-border">
              <SectionTitle icon={Clock} title="予約受付ルール"
                desc="当日予約・直前予約・先の予約をお客様にどこまで許可するかを設定します。日本のサロン平均は3〜24時間前です。" />
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <Label className="mb-2 block font-serif text-sm">最短リードタイム</Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} max={168} value={form.booking_lead_time_hours}
                      onChange={e => setForm({...form, booking_lead_time_hours: Math.max(0, parseInt(e.target.value) || 0)})}
                      className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                    <span className="text-xs font-serif text-muted-foreground">時間前まで</span>
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block font-serif text-sm">予約可能な先日数</Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={7} max={365} value={form.booking_max_days_ahead}
                      onChange={e => setForm({...form, booking_max_days_ahead: Math.max(7, parseInt(e.target.value) || 60)})}
                      className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                    <span className="text-xs font-serif text-muted-foreground">日先まで</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
                <div>
                  <div className="font-serif text-sm">お客様によるオンラインキャンセル</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {form.allow_customer_cancel ? `✅ 許可中 — 予約${form.cancel_deadline_hours}時間前まで` : "❌ 不可 — お電話のみ受付"}
                  </div>
                </div>
                <Switch checked={form.allow_customer_cancel} onCheckedChange={v => setForm({...form, allow_customer_cancel: v})} />
              </div>

              {form.allow_customer_cancel && (
                <div>
                  <Label className="mb-2 block font-serif text-sm">キャンセル受付期限</Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} max={72} value={form.cancel_deadline_hours}
                      onChange={e => setForm({...form, cancel_deadline_hours: Math.max(0, parseInt(e.target.value) || 0)})}
                      className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                    <span className="text-xs font-serif text-muted-foreground">時間前まで</span>
                  </div>
                </div>
              )}
            </section>
          </TabsContent>

          {/* ========== 📨 お客様への配信 ========== */}
          <TabsContent value="messaging" className="space-y-12">
            <section className="space-y-5">
              <SectionTitle icon={Sparkles} title="お客様への自動配信"
                desc="LINE登録済みのお客様にはLINE、未登録のお客様にはメールが自動的に送られます（重複しません）。" />
            </section>

            {/* 来店前日リマインド */}
            <section className="space-y-4 pt-6 border-t border-border">
              <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-gold mt-0.5" />
                  <div>
                    <div className="font-serif text-sm">来店前日リマインド</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      予約日の前日{form.reminder_hour}時頃に「明日お待ちしています」を自動配信。無断キャンセル激減。
                    </div>
                  </div>
                </div>
                <Switch checked={form.reminder_enabled} onCheckedChange={v => setForm({...form, reminder_enabled: v})} />
              </div>
              {form.reminder_enabled && (
                <div className="pl-8">
                  <Label className="block font-serif text-xs mb-2">配信時刻</Label>
                  <select value={form.reminder_hour} onChange={e => setForm({...form, reminder_hour: parseInt(e.target.value)})}
                    className="bg-background border border-border px-3 py-1.5 text-xs rounded-none focus:outline-none focus:border-gold">
                    {[10,11,12,13,14,15,16,17,18,19,20,21].map(h => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-2">推奨：18〜20時（仕事帰りで一番開封されやすい時間帯）</p>
                </div>
              )}
            </section>

            {/* サンクス・アフターケア */}
            <section className="space-y-4 pt-6 border-t border-border">
              <SectionTitle icon={Mail} title="サンクス・アフターケアメール"
                desc="来店後の自動フォロー。送信日数をオーナーが自由に設定できます。" />
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <Label className="mb-2 block font-serif text-sm">サンクスメール</Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} max={7} value={form.thank_you_delay_days}
                      onChange={e => setForm({...form, thank_you_delay_days: Math.max(0, Math.min(7, parseInt(e.target.value) || 0))})}
                      className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                    <span className="text-xs font-serif text-muted-foreground">日後に送信</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">推奨：1日後</p>
                </div>
                <div>
                  <Label className="mb-2 block font-serif text-sm">アフターケアメール</Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={3} max={21} value={form.aftercare_delay_days}
                      onChange={e => setForm({...form, aftercare_delay_days: Math.max(3, Math.min(21, parseInt(e.target.value) || 7))})}
                      className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                    <span className="text-xs font-serif text-muted-foreground">日後に送信</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">推奨：7日後（ヘアケアアドバイス）</p>
                </div>
              </div>
            </section>

            {/* 離脱客ステップ */}
            <section className="space-y-4 pt-6 border-t border-border">
              <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
                <div className="flex items-start gap-3">
                  <RefreshCw className="w-4 h-4 text-gold mt-0.5" />
                  <div>
                    <div className="font-serif text-sm">離脱客の自動復活ステップ</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      指定日数経過した顧客に自動でクーポンを配信。段階・割引率は自由にカスタマイズ可能。
                    </div>
                  </div>
                </div>
                <Switch checked={form.reactivation_enabled} onCheckedChange={v => setForm({...form, reactivation_enabled: v})} />
              </div>

              {form.reactivation_enabled && (
                <div className="pl-2">
                  <ReactivationStagesEditor
                    value={form.reactivation_stages}
                    onChange={stages => setForm({...form, reactivation_stages: stages})}
                  />
                  <Button type="button" onClick={runReactivation} disabled={runningReactivation} variant="outline"
                    className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5 mt-3">
                    {runningReactivation ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
                    今すぐ抽出して送信予約 <span className="ml-2 opacity-60 text-[10px]">RUN NOW</span>
                  </Button>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    ※ 通常は毎日自動で実行されます（保存後に有効化）。
                  </p>
                </div>
              )}
            </section>

            {/* Send Guard - 配信前の安全装置 */}
            <section className="space-y-4 pt-6 border-t border-border">
              <div>
                <div className="font-serif text-sm">配信モード</div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  事故防止のため、お客様への配信を「事前承認」で運用することができます。
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                {[
                  { v: "auto", label: "完全自動", desc: "条件を満たした顧客に自動で配信" },
                  { v: "semi_auto", label: "半自動（事前承認）", desc: "全配信をオーナーが承認後に送信" },
                  { v: "per_template", label: "テンプレート別", desc: "選んだ種類のみ承認制" },
                ].map(opt => (
                  <button key={opt.v} type="button"
                    onClick={() => setForm({...form, approval_mode: opt.v as any})}
                    className={`text-left p-4 border transition-colors ${form.approval_mode === opt.v ? "border-gold bg-gold/5" : "border-border hover:border-gold/40"}`}>
                    <div className="font-serif text-xs mb-1">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground leading-relaxed">{opt.desc}</div>
                  </button>
                ))}
              </div>

              {form.approval_mode === "per_template" && (
                <div className="p-4 border border-border bg-secondary/20">
                  <div className="text-[11px] font-serif mb-2">承認制にするテンプレート</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { k: "reactivation", l: "復活クーポン" },
                      { k: "birthday", l: "お誕生日" },
                      { k: "anniversary", l: "記念日" },
                      { k: "vip_upgrade", l: "VIPランクアップ" },
                      { k: "review_request", l: "レビュー依頼" },
                    ].map(t => {
                      const on = form.approval_required_templates.includes(t.k);
                      return (
                        <button key={t.k} type="button"
                          onClick={() => setForm({
                            ...form,
                            approval_required_templates: on
                              ? form.approval_required_templates.filter(x => x !== t.k)
                              : [...form.approval_required_templates, t.k]
                          })}
                          className={`px-3 py-1.5 text-[11px] border transition-colors ${on ? "border-gold bg-gold/10" : "border-border"}`}>
                          {t.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-4 border border-border bg-secondary/20">
                <Label className="text-xs font-serif">インポート直後の沈黙期間（日数）</Label>
                <p className="text-[10px] text-muted-foreground mt-1 mb-2">
                  サロンボード/CSV取込みの直後、自動配信を停止する日数。デフォルト 7日。
                </p>
                <Input type="number" min={0} max={60}
                  value={form.import_quiet_days}
                  onChange={e => setForm({...form, import_quiet_days: parseInt(e.target.value) || 0})}
                  className="rounded-none w-32"/>
              </div>

              <div className="p-4 border border-border bg-secondary/20 grid grid-cols-2 gap-6">
                <div>
                  <Label className="text-xs font-serif">配信間隔の最低日数（クールダウン）</Label>
                  <p className="text-[10px] text-muted-foreground mt-1 mb-2">
                    同じお客様への次の自動配信は、何日空ければOKか。デフォルト 7日。
                  </p>
                  <Input type="number" min={0} max={90}
                    value={(form as any).frequency_cap_days ?? 7}
                    onChange={e => setForm({...form, frequency_cap_days: parseInt(e.target.value) || 0} as any)}
                    className="rounded-none w-32"/>
                </div>
                <div>
                  <Label className="text-xs font-serif">月あたりの配信上限</Label>
                  <p className="text-[10px] text-muted-foreground mt-1 mb-2">
                    1人のお客様に1ヶ月で送る自動配信の最大数。デフォルト 4通。
                  </p>
                  <Input type="number" min={1} max={30}
                    value={(form as any).frequency_cap_per_month ?? 4}
                    onChange={e => setForm({...form, frequency_cap_per_month: parseInt(e.target.value) || 1} as any)}
                    className="rounded-none w-32"/>
                </div>
              </div>


              {form.approval_mode !== "auto" && (
                <p className="text-[10px] text-muted-foreground">
                  → 承認待ちの配信は <Link to="/approvals" className="text-gold gold-underline">配信の事前承認</Link> ページで確認できます
                </p>
              )}
            </section>

            {/* 誕生日クーポン */}
            <section className="space-y-4 pt-6 border-t border-border">
              <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
                <div className="flex items-start gap-3">
                  <Cake className="w-4 h-4 text-gold mt-0.5" />
                  <div>
                    <div className="font-serif text-sm">お誕生月クーポン</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      お客様の誕生月に{form.birthday_discount_percent}%OFFクーポンを自動配信。
                    </div>
                  </div>
                </div>
                <Switch checked={form.birthday_enabled} onCheckedChange={v => setForm({...form, birthday_enabled: v})} />
              </div>
              {form.birthday_enabled && (
                <div className="pl-8">
                  <Label className="block font-serif text-xs mb-2">割引率</Label>
                  <select value={form.birthday_discount_percent} onChange={e => setForm({...form, birthday_discount_percent: parseInt(e.target.value)})}
                    className="bg-background border border-border px-3 py-1.5 text-xs rounded-none focus:outline-none focus:border-gold">
                    {[10, 15, 20, 25, 30, 40, 50].map(d => <option key={d} value={d}>{d}%OFF</option>)}
                  </select>
                </div>
              )}
            </section>

            {/* 営業時間外のLINE自動応答 */}
            <section className="space-y-4 pt-6 border-t border-border">
              <SectionTitle icon={MessageCircle} title="営業時間外のLINE自動応答"
                desc="営業時間外に来たLINEメッセージへAIが自動で一次返信。" />
              <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
                <div>
                  <div className="font-serif text-sm">自動応答</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {form.auto_reply_enabled
                      ? form.auto_reply_use_ai ? "✨ AIが毎回パーソナライズ返信" : "✅ 固定文で返信"
                      : "❌ 無効 — 手動のみ"}
                  </div>
                </div>
                <Switch checked={form.auto_reply_enabled} onCheckedChange={v => setForm({...form, auto_reply_enabled: v})} />
              </div>
              {form.auto_reply_enabled && (
                <>
                  <div className="flex items-center justify-between p-5 border border-border">
                    <div>
                      <div className="font-serif text-sm">AIで毎回パーソナライズ</div>
                      <div className="text-[10px] text-muted-foreground mt-1">OFFにすると下記の固定文を毎回送信</div>
                    </div>
                    <Switch checked={form.auto_reply_use_ai} onCheckedChange={v => setForm({...form, auto_reply_use_ai: v})} />
                  </div>
                  <div>
                    <Label className="mb-2 block font-serif text-sm">カスタム応答文（任意）</Label>
                    <textarea value={form.auto_reply_message}
                      onChange={e => setForm({...form, auto_reply_message: e.target.value.slice(0, 500)})}
                      rows={4} placeholder="（空欄ならサロン情報を含む既定文を使用）"
                      className="w-full px-3 py-2 border border-border bg-background text-sm font-serif rounded-none focus:outline-none focus:border-gold" />
                  </div>
                </>
              )}
            </section>
          </TabsContent>

          {/* ========== 🔔 オーナー通知 ========== */}
          <TabsContent value="notify" className="space-y-12">
            <section className="space-y-5">
              <SectionTitle icon={Bell} title="予約通知（複数人・メール／LINE対応）"
                desc="新規予約・変更・キャンセルが入った瞬間に、ここで登録したスタッフへ通知が届きます。メール・LINEを宛先ごとに選べます（最大10件）。" />

              <NotificationRecipientsBadge variant="settings" />
              {/* 主要メール（後方互換） */}
              <div>
                <Label className="mb-2 block font-serif text-sm">代表メールアドレス</Label>
                <Input type="email" value={form.owner_notification_email}
                  onChange={e => setForm({...form, owner_notification_email: e.target.value})}
                  placeholder="info@saronboost.com"
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                <p className="text-[10px] text-muted-foreground mt-2">空欄の場合、下記の宛先リストのみが使用されます</p>
              </div>

              <Button type="button" onClick={sendTestEmail} disabled={testing} variant="outline"
                className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
                {testing ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
                代表メール宛にテスト通知
              </Button>

              {/* 追加宛先リスト */}
              <div className="pt-6 border-t border-border space-y-3">
                <div className="flex items-baseline justify-between">
                  <Label className="font-serif text-sm">追加の通知先（スタッフ・オーナー本人など）</Label>
                  <span className="text-[10px] text-muted-foreground">{form.notification_recipients.length} / 10</span>
                </div>

                {form.notification_recipients.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    まだ追加の通知先がありません。下のボタンから追加してください。
                  </p>
                )}

                {form.notification_recipients.map((r, i) => (
                  <div key={i} className="border border-border p-4 space-y-3 bg-secondary/20">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground tracking-wider uppercase">通知先 #{i + 1}</span>
                      <button type="button"
                        onClick={() => setForm({ ...form, notification_recipients: form.notification_recipients.filter((_, idx) => idx !== i) })}
                        className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label className="mb-1.5 block text-[11px]">名前（任意）</Label>
                        <Input value={r.name}
                          onChange={e => {
                            const next = [...form.notification_recipients];
                            next[i] = { ...next[i], name: e.target.value };
                            setForm({ ...form, notification_recipients: next });
                          }}
                          placeholder="例：山田 店長"
                          className="text-sm" />
                      </div>
                      <div>
                        <Label className="mb-1.5 block text-[11px]">メールアドレス</Label>
                        <Input type="email" value={r.email}
                          onChange={e => {
                            const next = [...form.notification_recipients];
                            next[i] = { ...next[i], email: e.target.value };
                            setForm({ ...form, notification_recipients: next });
                          }}
                          placeholder="staff@example.com"
                          className="text-sm" />
                      </div>
                      <div className="md:col-span-2">
                        <Label className="mb-1.5 block text-[11px]">LINE ユーザーID（任意・LINEで通知する場合）</Label>
                        <Input value={r.line_user_id}
                          onChange={e => {
                            const next = [...form.notification_recipients];
                            next[i] = { ...next[i], line_user_id: e.target.value };
                            setForm({ ...form, notification_recipients: next });
                          }}
                          placeholder="U で始まる32文字のID"
                          className="text-sm font-mono" />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          ※ サロンのLINE公式アカウントを友だち追加した方のIDが必要です。確認方法は「連携」タブをご覧ください。
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-4 pt-2">
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox"
                          checked={r.channels.includes("email")}
                          onChange={e => {
                            const next = [...form.notification_recipients];
                            const ch = new Set(next[i].channels);
                            if (e.target.checked) ch.add("email"); else ch.delete("email");
                            next[i] = { ...next[i], channels: Array.from(ch) };
                            setForm({ ...form, notification_recipients: next });
                          }}
                        />
                        <Mail className="w-3.5 h-3.5" /> メール
                      </label>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox"
                          checked={r.channels.includes("line")}
                          onChange={e => {
                            const next = [...form.notification_recipients];
                            const ch = new Set(next[i].channels);
                            if (e.target.checked) ch.add("line"); else ch.delete("line");
                            next[i] = { ...next[i], channels: Array.from(ch) };
                            setForm({ ...form, notification_recipients: next });
                          }}
                        />
                        <MessageCircle className="w-3.5 h-3.5" /> LINE
                      </label>
                    </div>
                  </div>
                ))}

                <Button type="button" variant="outline"
                  disabled={form.notification_recipients.length >= 10}
                  onClick={() => setForm({
                    ...form,
                    notification_recipients: [
                      ...form.notification_recipients,
                      { name: "", email: "", line_user_id: "", channels: ["email"] },
                    ],
                  })}
                  className="w-full rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
                  + 通知先を追加
                </Button>
              </div>
            </section>
          </TabsContent>

          {/* ========== 🔗 連携 ========== */}
          <TabsContent value="connect" className="space-y-12">
            {/* Google */}
            <section className="space-y-5">
              <SectionTitle icon={Star} title="Googleレビュー誘導"
                desc="来店後、リピーター（2回目以降のお客様）に自動でレビュー依頼を配信します。" />
              <div>
                <Label className="mb-2 block font-serif text-sm">レビュー投稿URL</Label>
                <Input value={form.google_review_url} onChange={e => setForm({...form, google_review_url: e.target.value})}
                  placeholder="https://g.page/r/..."
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
              </div>
            </section>

            {/* LINE */}
            <section className="space-y-5 pt-6 border-t border-border">
              <SectionTitle icon={MessageCircle} title="LINE公式アカウント連携"
                desc="LINE登録済みのお客様にはLINEのみ、未登録のお客様にはメールのみが届く設計です（重複しません）。" />

              <div className="bg-secondary/30 p-4 border border-border space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                <div className="font-serif text-foreground text-xs mb-1">📋 セットアップ手順</div>
                <ol className="list-decimal list-inside space-y-1">
                  <li>LINE Developers コンソール → Messaging API設定</li>
                  <li>「チャネルアクセストークン（長期）」を発行 → 下に貼り付け</li>
                  <li>「チャネル基本設定」→「チャネルシークレット」をコピー → 下に貼り付け</li>
                  <li>
                    Webhook URLに次を設定：
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
                <Label className="mb-2 block font-serif text-sm">LINE 友だち追加URL</Label>
                <Input value={form.line_add_friend_url} onChange={e => setForm({...form, line_add_friend_url: e.target.value})}
                  placeholder="https://lin.ee/xxxxxx"
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
              </div>
              <div>
                <Label className="mb-2 block font-serif text-sm">チャネルアクセストークン</Label>
                <Input type="password" value={form.line_channel_access_token}
                  onChange={e => setForm({...form, line_channel_access_token: e.target.value})}
                  placeholder="長期トークン"
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
              </div>
              <div>
                <Label className="mb-2 block font-serif text-sm">チャネルシークレット</Label>
                <Input type="password" value={form.line_channel_secret}
                  onChange={e => setForm({...form, line_channel_secret: e.target.value})}
                  placeholder="Webhook署名検証に使用"
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
              </div>

              <div className="pt-4 border-t border-border/50 space-y-3">
                <Label className="block font-serif text-sm">🧪 LINEテスト送信</Label>
                <p className="text-[10px] text-muted-foreground">ご自身のLINE UserID（U で始まる33文字）を入力してテスト送信</p>
                <Input value={lineTestUserId} onChange={e => setLineTestUserId(e.target.value)}
                  placeholder="U1234567890abcdef..."
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold font-mono text-xs" />
                <Button type="button" onClick={sendLineTest} disabled={testingLine} variant="outline"
                  className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
                  {testingLine ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
                  LINEへテスト送信
                </Button>
              </div>

              <div className="pt-4 border-t border-border/50 space-y-3">
                <Label className="block font-serif text-sm">📱 SMSテスト送信</Label>
                <p className="text-[10px] text-muted-foreground">
                  Twilio接続のテスト。事前にTwilio Consoleで「Geo Permissions」の日本(Japan)をONにしてください。
                </p>
                <Input value={smsTestPhone} onChange={e => setSmsTestPhone(e.target.value)}
                  placeholder="09012345678"
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold font-mono text-xs" />
                <Button type="button" onClick={sendSmsTest} disabled={testingSms} variant="outline"
                  className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
                  {testingSms ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
                  SMSへテスト送信
                </Button>
              </div>

              <div className="pt-4 border-t border-border/50 space-y-3">
                <Label className="block font-serif text-sm">📱 リッチメニュー一発設定</Label>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  LINEトーク画面下に「予約 / 特典 / お問合せ」3ボタンを自動セットアップ。
                </p>
                <Button type="button" onClick={setupRichMenu} disabled={settingMenu} variant="outline"
                  className="rounded-none border-gold/40 text-xs tracking-luxury hover:bg-gold/5">
                  {settingMenu ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
                  リッチメニューを設定
                </Button>
              </div>
            </section>

            {/* 店舗別LINE設定 */}
            <section className="space-y-5 pt-6 border-t border-border">
              <SectionTitle icon={MessageCircle} title="店舗別LINE公式アカウント設定"
                desc="店舗ごとにLINE公式アカウントを分けたい場合のみ設定してください。未設定の店舗は上記のオーナー共通LINEで送受信されます。" />
              <LocationLineSettingsEditor />
            </section>

            {/* 外部予約サイト */}
            <section
              id="inbound"
              className={`space-y-5 pt-6 border-t border-border scroll-mt-24 ${highlightSection === "inbound" ? "ring-2 ring-gold/60 ring-offset-4 ring-offset-background animate-pulse-once" : ""}`}
              ref={(el) => { if (el && highlightSection === "inbound") el.scrollIntoView({ behavior: "smooth", block: "start" }); }}
            >
              <SectionTitle icon={Inbox} title="外部予約サイト自動連携"
                desc="ホットペッパー / minimo / 楽天Beautyの予約通知メールを下記アドレスへ転送するだけ。DNSや専門設定は一切不要、コピー＆ペーストで完了します。" />

              <div className="border border-gold/40 bg-gradient-to-br from-gold/5 to-transparent p-5 rounded-sm">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-gold/20 text-gold flex items-center justify-center font-serif text-sm flex-shrink-0">1</div>
                  <div className="flex-1">
                    <div className="font-serif text-base mb-1">あなた専用の転送アドレス</div>
                    <p className="text-xs text-muted-foreground">下記をコピーして、各サイトの登録メール（Gmail等）の転送先に設定してください。</p>
                  </div>
                </div>

                {[
                  { code: "sb", label: "サロンボード", color: "text-emerald-500", desc: "サロンボードの予約お知らせメール（ネット予約・キャンセル等の通知メール）の転送先には、このアドレスを登録してください。" },
                  { code: "hp", label: "ホットペッパービューティー", color: "text-orange-500" },
                  { code: "mn", label: "minimo（ミニモ）", color: "text-pink-500" },
                  { code: "rb", label: "楽天ビューティ", color: "text-red-500" },
                ].map(site => {
                  const addr = inboundKey ? `${site.code}-${inboundKey}@inbound.saronboost.com` : "（保存後に発行されます）";
                  return (
                    <div key={site.code} className="border border-border bg-background p-4 mb-3 last:mb-0">
                      <div className={`font-serif text-sm ${site.color} mb-2 font-medium`}>{site.label}</div>
                      {site.desc && <p className="text-[11px] text-muted-foreground mb-2">{site.desc}</p>}
                      <div className="flex items-center gap-2">
                        <Input value={addr} readOnly className="rounded-none border-x-0 border-t-0 px-0 text-sm font-mono bg-transparent" />
                        <Button type="button" size="sm"
                          onClick={() => { navigator.clipboard.writeText(addr); toast.success("コピーしました"); }}
                          disabled={!inboundKey}
                          className="rounded-none bg-gold text-background hover:bg-gold/90 tracking-luxury">
                          <Copy className="w-3.5 h-3.5 mr-1.5" /> コピー
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <details className="border border-border p-4 bg-secondary/10 rounded-sm" open>
                <summary className="cursor-pointer font-serif text-sm flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gold" /> 
                  <span className="font-medium">ステップ2：Gmail転送設定の手順（3分で完了）</span>
                </summary>
                <ol className="mt-4 text-sm text-foreground/80 space-y-2.5 leading-relaxed list-decimal list-inside pl-2">
                  <li>サロンのGmailを開き、右上の歯車 →「<strong>すべての設定を表示</strong>」</li>
                  <li>「<strong>メール転送と POP/IMAP</strong>」タブ →「<strong>転送先アドレスを追加</strong>」</li>
                  <li>上記の専用アドレスを貼り付け → 確認メールが届くので承認</li>
                  <li>「<strong>フィルタとブロック中のアドレス</strong>」→「<strong>新しいフィルタを作成</strong>」</li>
                  <li>「From」欄にホットペッパーの送信元アドレスを入力</li>
                  <li>「<strong>次のアドレスに転送する</strong>」を選択 → 専用アドレスを指定 → 完了</li>
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">※ DNSやResendアカウント作成などの専門知識は一切不要です。</p>
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
                      const Icon = log.status === "created" ? CheckCircle2 : log.status === "duplicate" || log.status === "skipped" ? AlertCircle : XCircle;
                      const color = log.status === "created" ? "text-emerald-400" : log.status === "failed" ? "text-red-400" : "text-amber-400";
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

            {/* 休業のお知らせ */}
            <section className="pt-6 border-t border-border">
              <HolidayNoticeBroadcast />
            </section>
          </TabsContent>

          {/* ========== 🛠️ 開発者ツール ========== */}
          <TabsContent value="dev" className="space-y-12">
            <div className="p-4 border border-amber-500/40 bg-amber-500/5 text-[11px] text-amber-200 leading-relaxed">
              ⚠️ <strong>注意：このタブの操作は本番データに影響します。</strong>動作確認以外の用途では触らないでください。
            </div>

            <section className="space-y-5">
              <SectionTitle icon={FlaskConical} title="テストモード"
                desc="ONにすると、公開予約フォームから入った予約・顧客に「テスト」フラグが自動付与され、ダッシュボードの集計から完全に除外されます。" />
              <div className="flex items-center justify-between p-5 border border-border bg-secondary/20">
                <div>
                  <div className="font-serif text-sm">テストモード</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {form.test_mode ? "🧪 ON — テスト中の予約は集計から除外" : "● OFF — 通常運用中"}
                  </div>
                </div>
                <Switch checked={form.test_mode} onCheckedChange={toggleTestMode} />
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline"
                    className="rounded-none border-destructive/40 text-destructive text-xs tracking-luxury hover:bg-destructive/5">
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    テストデータを一括削除
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>テストデータをすべて削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                      「テスト」フラグの付いた予約・顧客データを完全に削除します。<br />
                      この操作は取り消せません。本番データには影響しません。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteTestData} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
                      {deleting && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                      削除する
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          </TabsContent>
        </Tabs>

        {/* 共通保存ボタン */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-border mt-12 py-4 z-10">
          <Button onClick={save} disabled={saving}
            className="rounded-none px-12 py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow w-full sm:w-auto">
            {saving && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
            すべての設定を保存 <span className="ml-2 opacity-60 text-[10px]">SAVE ALL</span>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default Settings;
