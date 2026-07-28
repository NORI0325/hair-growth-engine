import { useState, useMemo, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, MessageCircle, Mail, Smartphone, Sparkles, Users, Filter, Save, BookmarkPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenant";
import { useCurrentLocationId } from "@/hooks/useLocations";

interface Customer {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  line_user_id?: string | null;
  birthday?: string | null;
  gender?: string | null;
  last_visit_date?: string | null;
  visit_count?: number;
  total_spent?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
}

type Gender = "female" | "male" | "other" | "unknown";
type AgeGroup = "teens" | "20s" | "30s" | "40s" | "50s" | "60s+";

interface SegmentState {
  genders: Gender[];
  ages: AgeGroup[];
  vipOnly: boolean;
  daysMin: string;
  daysMax: string;
  menuKw: string;
  visitMin: string;
  visitMax: string;
  spentMin: string;
  spentMax: string;
  staffIds: string[];
  birthdayMonths: number[];
  tagIdsAny: string[];
  excludeTagIds: string[];
  hasEmail: boolean;
  hasPhone: boolean;
  hasLine: boolean;
  cycleDays: string;
  toleranceDays: string;
  excludeRecentBookingDays: string;
}

const emptySegment = (): SegmentState => ({
  genders: [], ages: [], vipOnly: false,
  daysMin: "", daysMax: "", menuKw: "",
  visitMin: "", visitMax: "", spentMin: "", spentMax: "",
  staffIds: [], birthdayMonths: [],
  tagIdsAny: [], excludeTagIds: [],
  hasEmail: false, hasPhone: false, hasLine: false,
  cycleDays: "", toleranceDays: "7",
  excludeRecentBookingDays: "",
});

const PRESETS: { key: string; label: string; subject: string; body: string; tip: string }[] = [
  {
    key: "female-30s",
    label: "女性30代向け",
    subject: "{{name}}様だけの特別なご提案",
    body: `{{name}} 様\n\nいつもありがとうございます。\n前回のご来店から{{days_since}}が経ちましたね。\n\n{{last_menu}}を担当しました{{staff_name}}より、{{name}}様にぴったりの【{{next_suggested_menu}}】を、特別価格20%OFFでご提案させていただきます。\n\n艶感と扱いやすさを両立する季節限定メニューです。\nご都合いかがでしょうか？`,
    tip: "美意識・トレンド感・パーソナル感を重視",
  },
  {
    key: "male",
    label: "男性向け",
    subject: "{{name}}様、次回もお待ちしております",
    body: `{{name}} 様\n\nいつもありがとうございます。\n前回から{{days_since}}が経ちました。\n\nそろそろメンテナンスのタイミングかと思いご連絡しました。{{next_suggested_menu}}を、平日限定15%OFFでご利用いただけます。\n\n短時間でスッキリ整えますので、お仕事帰りにもどうぞ。`,
    tip: "シンプル・実用・時短を強調",
  },
  {
    key: "vip",
    label: "VIP向け",
    subject: "{{name}}様への感謝のご案内",
    body: `{{name}} 様\n\nいつも当サロンをご愛顧いただき、心より感謝申し上げます。\n\n{{name}}様のような大切なお客様だけにお届けする、シーズナル限定の特別メニューをご用意いたしました。\n担当の{{staff_name}}が、{{name}}様の前回の{{last_menu}}に合わせて最適なご提案をいたします。\n\nご予約は通常枠より優先してお取りいたしますので、お気軽にご返信くださいませ。`,
    tip: "特別感・感謝・優先扱いを前面に",
  },
  {
    key: "dormant",
    label: "休眠（180日以上）向け",
    subject: "{{name}}様、お元気にされていますか？",
    body: `{{name}} 様\n\nご無沙汰しております。\n前回のご来店から{{days_since}}、いかがお過ごしでしょうか。\n\n{{name}}様にぜひもう一度ご来店いただきたく、復活割30%OFFのご案内をお送りしました。\n{{next_suggested_menu}}など、髪のお悩みに合わせて{{staff_name}}が丁寧にご提案いたします。\n\nまたお会いできるのを楽しみにお待ちしております。`,
    tip: "押し付けず温かみ・大幅割引で背中を押す",
  },
];

const BulkLineDialog = ({ open, onClose, customers }: Props) => {
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("サロンからのお知らせ");
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [useLine, setUseLine] = useState(true);
  const [useSms, setUseSms] = useState(false);
  const [useEmail, setUseEmail] = useState(false);
  const [skipRecent, setSkipRecent] = useState(true);
  const [skipDays, setSkipDays] = useState(7);

  const [seg, setSeg] = useState<SegmentState>(emptySegment());
  const updateSeg = <K extends keyof SegmentState>(k: K, v: SegmentState[K]) =>
    setSeg((s) => ({ ...s, [k]: v }));

  // 補助マスタ
  const [staffOptions, setStaffOptions] = useState<{ id: string; name: string }[]>([]);
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string; color: string }[]>([]);
  const [savedSegments, setSavedSegments] = useState<{ id: string; name: string; conditions: any }[]>([]);

  // サーバープレビュー
  const [serverPreview, setServerPreview] = useState<{ total: number; line: number; sms: number; email: number; segment_skipped: number; recent_booking_skipped: number; cooldown_skipped: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const toggle = <T,>(arr: T[], v: T): T[] => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  // 初回マスタ読込
  useEffect(() => {
    if (!open || !tenantId || !locationId) return;
    (async () => {
      const [{ data: staff }, { data: tags }, { data: segs }] = await Promise.all([
        supabase.from("staff").select("id, name").eq("owner_id", tenantId).eq("location_id", locationId).eq("active", true).order("name"),
        supabase.from("customer_tags" as any).select("id, name, color").eq("owner_id", tenantId).order("sort_order"),
        supabase.from("broadcast_segments" as any).select("id, name, conditions").eq("owner_id", tenantId).order("updated_at", { ascending: false }),
      ]);
      setStaffOptions((staff || []) as any);
      setTagOptions((tags || []) as any);
      setSavedSegments((segs || []) as any);
    })();
  }, [open, tenantId, locationId]);

  // セグメントをAPI形式に変換
  const buildSegmentPayload = useCallback(() => ({
    genders: seg.genders,
    age_groups: seg.ages,
    vip_only: seg.vipOnly,
    days_since_min: seg.daysMin ? Number(seg.daysMin) : null,
    days_since_max: seg.daysMax ? Number(seg.daysMax) : null,
    menu_keyword: seg.menuKw || null,
    visit_count_min: seg.visitMin ? Number(seg.visitMin) : null,
    visit_count_max: seg.visitMax ? Number(seg.visitMax) : null,
    total_spent_min: seg.spentMin ? Number(seg.spentMin) : null,
    total_spent_max: seg.spentMax ? Number(seg.spentMax) : null,
    staff_ids: seg.staffIds,
    birthday_months: seg.birthdayMonths,
    tag_ids_any: seg.tagIdsAny,
    exclude_tag_ids: seg.excludeTagIds,
    has_email: seg.hasEmail,
    has_phone: seg.hasPhone,
    has_line: seg.hasLine,
    recommended_cycle_days: seg.cycleDays ? Number(seg.cycleDays) : null,
    recommended_tolerance_days: seg.toleranceDays ? Number(seg.toleranceDays) : null,
  }), [seg]);

  // サーバープレビュー（debounce）
  useEffect(() => {
    if (!open || !tenantId || !locationId || customers.length === 0) return;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      const { data, error } = await supabase.functions.invoke("broadcast-preview", {
        body: {
          owner_id: tenantId,
          location_id: locationId,
          customer_ids: customers.map((c) => c.id),
          segment: buildSegmentPayload(),
          skip_recent_days: skipRecent ? skipDays : 0,
          exclude_recent_booking_days: seg.excludeRecentBookingDays ? Number(seg.excludeRecentBookingDays) : 0,
        },
      });
      setPreviewLoading(false);
      if (!error && data) setServerPreview(data as any);
    }, 400);
    return () => clearTimeout(timer);
  }, [open, tenantId, locationId, customers, seg, skipRecent, skipDays, buildSegmentPayload]);

  const reach = useMemo(() => ({
    line: customers.filter((c) => /^U[0-9a-f]{32}$/i.test(c.line_user_id || "")).length,
    sms: customers.filter((c) => !!c.phone).length,
    email: customers.filter((c) => !!c.email).length,
  }), [customers]);

  const applyPreset = (k: string) => {
    const p = PRESETS.find(x => x.key === k);
    if (!p) return;
    setMessage(p.body);
    setSubject(p.subject);
    const ns = emptySegment();
    if (k === "female-30s") { ns.genders = ["female"]; ns.ages = ["30s"]; }
    if (k === "male") { ns.genders = ["male"]; }
    if (k === "vip") { ns.vipOnly = true; }
    if (k === "dormant") { ns.daysMin = "180"; }
    setSeg(ns);
    toast.success(`「${p.label}」テンプレを適用しました`);
  };

  const aiSuggest = async () => {
    setAiLoading(true);
    const segDesc: string[] = [];
    if (seg.genders.length) segDesc.push(`性別: ${seg.genders.join("/")}`);
    if (seg.ages.length) segDesc.push(`年代: ${seg.ages.join("/")}`);
    if (seg.vipOnly) segDesc.push("VIPのみ");
    if (seg.daysMin || seg.daysMax) segDesc.push(`最終来店: ${seg.daysMin || "0"}〜${seg.daysMax || "∞"}日`);
    if (seg.menuKw) segDesc.push(`前回メニュー: ${seg.menuKw}を含む`);
    if (seg.cycleDays) segDesc.push(`次回推奨日±${seg.toleranceDays || 7}日`);
    const segText = segDesc.length ? segDesc.join(" / ") : "全顧客";
    const target = serverPreview?.total ?? customers.length;
    const prompt = `美容サロンの一斉送信文面を作成してください。\n\n対象セグメント: ${segText}\n対象人数: ${target}名\n\n要件:\n- {{name}} {{last_menu}} {{days_since}} {{staff_name}} {{next_suggested_menu}} の変数を活用\n- 特別感とパーソナル感を出す\n- 具体的なオファー（割引/メニュー）を含める\n- LINE/メール両対応で250文字以内\n- 押し付けがましくなく、自然で温かみのある日本語\n\n本文のみ返してください（前置きや説明は不要）。`;
    const { data, error } = await supabase.functions.invoke("ai-template-assistant", {
      body: { text: prompt, action: "custom", instruction: "上記要件に従って本文を作成してください", channel: useLine ? "line" : "email" },
    });
    setAiLoading(false);
    if (error || !(data as any)?.result) {
      toast.error("AI提案に失敗しました");
      return;
    }
    setMessage((data as any).result);
    toast.success("AI提案を反映しました");
  };

  const saveSegment = async () => {
    const name = window.prompt("セグメント名を入力してください（例: 30代女性カラー客）");
    if (!name) return;
    if (!tenantId) { toast.error("店舗の所属情報を確認してください"); return; }
    const { error } = await supabase.from("broadcast_segments" as any).insert({
      owner_id: tenantId, name, conditions: seg,
    });
    if (error) { toast.error("保存に失敗しました"); return; }
    toast.success(`セグメント「${name}」を保存しました`);
    const { data: segs } = await supabase.from("broadcast_segments" as any).select("id, name, conditions").eq("owner_id", tenantId).order("updated_at", { ascending: false });
    setSavedSegments((segs || []) as any);
  };

  const loadSegment = (id: string) => {
    const s = savedSegments.find((x) => x.id === id);
    if (!s) return;
    setSeg({ ...emptySegment(), ...(s.conditions || {}) });
    toast.success(`「${s.name}」を読み込みました`);
  };

  const deleteSegment = async (id: string) => {
    if (!tenantId) return;
    if (!confirm("このセグメントを削除しますか？")) return;
    const { error } = await supabase.from("broadcast_segments" as any).delete().eq("owner_id", tenantId).eq("id", id);
    if (error) { toast.error("削除に失敗しました"); return; }
    setSavedSegments((s) => s.filter((x) => x.id !== id));
    toast.success("削除しました");
  };

  const send = async () => {
    if (!tenantId || !locationId) { toast.error("店舗を選択してください"); return; }
    if (message.trim().length < 2) { toast.error("メッセージを入力してください"); return; }
    if (!useLine && !useSms && !useEmail) { toast.error("送信チャネルを選択してください"); return; }
    if (serverPreview && serverPreview.total === 0) {
      if (!confirm("対象が0名です。それでも送信しますか？")) return;
    }
    if (serverPreview && serverPreview.total > 50) {
      if (!confirm(`${serverPreview.total}名に送信します。よろしいですか？`)) return;
    }
    setSending(true);
    const channels: string[] = [];
    if (useLine) channels.push("line");
    if (useSms) channels.push("sms");
    if (useEmail) channels.push("email");
    const { data, error } = await supabase.functions.invoke("bulk-broadcast", {
      body: {
        owner_id: tenantId,
        location_id: locationId,
        broadcast_request_id: crypto.randomUUID(),
        message, subject, channels,
        customer_ids: customers.map((c) => c.id),
        skip_recent_days: skipRecent ? skipDays : 0,
        exclude_recent_booking_days: seg.excludeRecentBookingDays ? Number(seg.excludeRecentBookingDays) : 0,
        segment: buildSegmentPayload(),
      },
    });
    setSending(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.message || error?.message || "送信に失敗しました");
      return;
    }
    const d = data as any;
    const parts: string[] = [];
    if (useLine) parts.push(`LINE ${d.line.sent}/${d.line.sent + d.line.failed + d.line.skipped}`);
    if (useSms) parts.push(`SMS ${d.sms.sent}/${d.sms.sent + d.sms.failed + d.sms.skipped}`);
    if (useEmail) parts.push(`メール ${d.email.sent}/${d.email.sent + d.email.failed + d.email.skipped}`);
    const skipped: string[] = [];
    if (d.segment_skipped > 0) skipped.push(`セグメント外${d.segment_skipped}名`);
    if (d.recent_booking_skipped > 0) skipped.push(`直近予約済${d.recent_booking_skipped}名`);
    if (d.cooldown_skipped > 0) skipped.push(`クールダウン${d.cooldown_skipped}名`);
    toast.success(`送信完了: ${parts.join(" · ")}${skipped.length ? ` ／ ${skipped.join("・")}スキップ` : ""}`);
    setMessage("");
    onClose();
  };

  const preview = customers.slice(0, 5).map((c) => c.full_name).join(" / ")
    + (customers.length > 5 ? ` 他${customers.length - 5}名` : "");

  const months = [1,2,3,4,5,6,7,8,9,10,11,12];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Send className="w-4 h-4 text-gold" />
            一斉送信
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* 対象サマリ + サーバープレビュー */}
          <div className="border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="eyebrow text-[10px]">— Recipients —</p>
              <p className="text-[10px] text-muted-foreground flex items-center gap-2">
                {previewLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                選択 <span className="font-serif-en text-foreground">{customers.length}</span>
                ／ 配信対象 <span className="font-serif-en text-gold text-base">{serverPreview?.total ?? "—"}</span> 名
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{preview}</p>
            {serverPreview && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                <div className="border border-border p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground">LINE可</div>
                  <div className="font-serif-en">{serverPreview.line}</div>
                </div>
                <div className="border border-border p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground">SMS可</div>
                  <div className="font-serif-en">{serverPreview.sms}</div>
                </div>
                <div className="border border-border p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground">メール可</div>
                  <div className="font-serif-en">{serverPreview.email}</div>
                </div>
              </div>
            )}
          </div>

          {/* 保存セグメント */}
          {savedSegments.length > 0 && (
            <div>
              <p className="eyebrow text-[10px] mb-2 flex items-center gap-1.5"><BookmarkPlus className="w-3 h-3" />— 保存済みセグメント —</p>
              <div className="flex gap-1.5 flex-wrap">
                {savedSegments.map((s) => (
                  <div key={s.id} className="flex items-center border border-border">
                    <button type="button" onClick={() => loadSegment(s.id)}
                      className="px-2.5 py-1 text-[11px] hover:bg-gold/5">
                      {s.name}
                    </button>
                    <button type="button" onClick={() => deleteSegment(s.id)}
                      className="px-1.5 py-1 border-l border-border hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* プリセット */}
          <div>
            <p className="eyebrow text-[10px] mb-2 flex items-center gap-1.5"><Sparkles className="w-3 h-3" />— セグメント別テンプレート —</p>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => applyPreset(p.key)}
                  className="text-left border border-border p-2.5 hover:bg-gold/5 hover:border-gold/40 transition-colors">
                  <p className="text-xs font-serif">{p.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{p.tip}</p>
                </button>
              ))}
            </div>
          </div>

          {/* セグメント絞込み */}
          <div className="border border-border bg-secondary/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="eyebrow text-[10px] flex items-center gap-1.5"><Filter className="w-3 h-3" />— 配信前の絞込み —</p>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => setSeg(emptySegment())}
                  className="rounded-none h-6 text-[10px]">クリア</Button>
                <Button type="button" size="sm" variant="ghost" onClick={saveSegment}
                  className="rounded-none h-6 text-[10px]"><Save className="w-3 h-3 mr-1" />保存</Button>
              </div>
            </div>

            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">性別</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["female","male","other","unknown"] as Gender[]).map((g) => (
                  <button key={g} type="button" onClick={() => updateSeg("genders", toggle(seg.genders, g))}
                    className={`px-2.5 py-1 text-[11px] border ${seg.genders.includes(g) ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>
                    {g === "female" ? "女性" : g === "male" ? "男性" : g === "other" ? "その他" : "未設定"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">年代</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["teens","20s","30s","40s","50s","60s+"] as AgeGroup[]).map((a) => (
                  <button key={a} type="button" onClick={() => updateSeg("ages", toggle(seg.ages, a))}
                    className={`px-2.5 py-1 text-[11px] border ${seg.ages.includes(a) ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>
                    {a === "teens" ? "10代" : a === "60s+" ? "60代+" : a}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">誕生月（複数選択可）</p>
              <div className="flex gap-1 flex-wrap">
                {months.map((m) => (
                  <button key={m} type="button" onClick={() => updateSeg("birthdayMonths", toggle(seg.birthdayMonths, m))}
                    className={`px-2 py-0.5 text-[10px] border ${seg.birthdayMonths.includes(m) ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>
                    {m}月
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">最終来店からの日数</p>
                <div className="flex items-center gap-1.5">
                  <Input type="number" placeholder="最小" value={seg.daysMin} onChange={(e) => updateSeg("daysMin", e.target.value)} className="rounded-none h-8 text-xs" />
                  <span className="text-[10px] text-muted-foreground">〜</span>
                  <Input type="number" placeholder="最大" value={seg.daysMax} onChange={(e) => updateSeg("daysMax", e.target.value)} className="rounded-none h-8 text-xs" />
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">前回メニューに含む</p>
                <Input placeholder="例: カラー" value={seg.menuKw} onChange={(e) => updateSeg("menuKw", e.target.value)} className="rounded-none h-8 text-xs" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">来店回数</p>
                <div className="flex items-center gap-1.5">
                  <Input type="number" placeholder="最小" value={seg.visitMin} onChange={(e) => updateSeg("visitMin", e.target.value)} className="rounded-none h-8 text-xs" />
                  <span className="text-[10px] text-muted-foreground">〜</span>
                  <Input type="number" placeholder="最大" value={seg.visitMax} onChange={(e) => updateSeg("visitMax", e.target.value)} className="rounded-none h-8 text-xs" />
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">累計売上 (円)</p>
                <div className="flex items-center gap-1.5">
                  <Input type="number" placeholder="最小" value={seg.spentMin} onChange={(e) => updateSeg("spentMin", e.target.value)} className="rounded-none h-8 text-xs" />
                  <span className="text-[10px] text-muted-foreground">〜</span>
                  <Input type="number" placeholder="最大" value={seg.spentMax} onChange={(e) => updateSeg("spentMax", e.target.value)} className="rounded-none h-8 text-xs" />
                </div>
              </div>
            </div>

            {/* 次回推奨日 */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">次回来店推奨日（来店周期 ± 許容日数）</p>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">周期</span>
                <Input type="number" placeholder="例: 45" value={seg.cycleDays} onChange={(e) => updateSeg("cycleDays", e.target.value)} className="rounded-none h-8 text-xs w-20" />
                <span className="text-[10px] text-muted-foreground">日 ±</span>
                <Input type="number" value={seg.toleranceDays} onChange={(e) => updateSeg("toleranceDays", e.target.value)} className="rounded-none h-8 text-xs w-16" />
                <span className="text-[10px] text-muted-foreground">日（"そろそろ"客に絞る）</span>
              </div>
            </div>

            {/* 担当スタッフ */}
            {staffOptions.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">担当スタッフ</p>
                <div className="flex gap-1.5 flex-wrap">
                  {staffOptions.map((s) => (
                    <button key={s.id} type="button" onClick={() => updateSeg("staffIds", toggle(seg.staffIds, s.id))}
                      className={`px-2.5 py-1 text-[11px] border ${seg.staffIds.includes(s.id) ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* タグ */}
            {tagOptions.length > 0 && (
              <>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1.5">タグ（いずれかを持つ）</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {tagOptions.map((t) => (
                      <button key={t.id} type="button" onClick={() => updateSeg("tagIdsAny", toggle(seg.tagIdsAny, t.id))}
                        className={`px-2.5 py-1 text-[11px] border ${seg.tagIdsAny.includes(t.id) ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}
                        style={seg.tagIdsAny.includes(t.id) ? undefined : { borderLeftWidth: 3, borderLeftColor: t.color }}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1.5">タグで除外</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {tagOptions.map((t) => (
                      <button key={t.id} type="button" onClick={() => updateSeg("excludeTagIds", toggle(seg.excludeTagIds, t.id))}
                        className={`px-2.5 py-1 text-[11px] border ${seg.excludeTagIds.includes(t.id) ? "bg-destructive/10 border-destructive text-destructive" : "border-border hover:bg-secondary"}`}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* チャネル所持 */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">配信先所持</p>
              <div className="flex gap-3 flex-wrap text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={seg.hasLine} onCheckedChange={(v) => updateSeg("hasLine", !!v)} />LINE登録あり
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={seg.hasEmail} onCheckedChange={(v) => updateSeg("hasEmail", !!v)} />メールあり
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={seg.hasPhone} onCheckedChange={(v) => updateSeg("hasPhone", !!v)} />電話あり
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={seg.vipOnly} onCheckedChange={(v) => updateSeg("vipOnly", !!v)} />
              <span className="text-[11px]">VIP（Gold以上）のみに絞る</span>
            </label>

            {/* 直近予約除外 */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">今後の予約済み顧客を除外（ダブり防止）</p>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">今後</span>
                <Input type="number" placeholder="例: 14" value={seg.excludeRecentBookingDays} onChange={(e) => updateSeg("excludeRecentBookingDays", e.target.value)} className="rounded-none h-8 text-xs w-20" />
                <span className="text-[10px] text-muted-foreground">日以内に予約がある人を除外（空欄で無効）</span>
              </div>
            </div>
          </div>

          {/* チャネル */}
          <div className="space-y-2">
            <p className="eyebrow text-[10px]">— 送信チャネル —</p>
            <label className="flex items-center justify-between border border-border p-2.5 cursor-pointer hover:bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={useLine} onCheckedChange={(v) => setUseLine(!!v)} />
                <MessageCircle className="w-4 h-4 text-[#06C755]" />
                <span className="text-sm">LINE</span>
              </div>
              <span className="text-[10px] text-muted-foreground">配信可能 {reach.line}名</span>
            </label>
            <label className="flex items-center justify-between border border-border p-2.5 cursor-pointer hover:bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={useSms} onCheckedChange={(v) => setUseSms(!!v)} />
                <Smartphone className="w-4 h-4 text-blue-600" />
                <span className="text-sm">SMS</span>
              </div>
              <span className="text-[10px] text-muted-foreground">配信可能 {reach.sms}名</span>
            </label>
            <label className="flex items-center justify-between border border-border p-2.5 cursor-pointer hover:bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={useEmail} onCheckedChange={(v) => setUseEmail(!!v)} />
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">メール</span>
              </div>
              <span className="text-[10px] text-muted-foreground">配信可能 {reach.email}名</span>
            </label>
          </div>

          {useEmail && (
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="メール件名"
              className="rounded-none text-sm"
            />
          )}

          <div className="relative">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              placeholder="例：{{name}} 様、前回の{{last_menu}}から{{days_since}}が経ちましたね。{{staff_name}}より{{next_suggested_menu}}を特別価格でご提案します。"
              className="rounded-none text-sm pr-28"
            />
            <Button type="button" size="sm" onClick={aiSuggest} disabled={aiLoading}
              className="absolute top-2 right-2 rounded-none h-7 text-[10px] bg-foreground hover:bg-foreground/90">
              {aiLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              AI提案
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            利用可能な変数：
            <code className="bg-secondary px-1 mx-0.5">{`{{name}}`}</code>
            <code className="bg-secondary px-1 mx-0.5">{`{{last_menu}}`}</code>
            <code className="bg-secondary px-1 mx-0.5">{`{{days_since}}`}</code>
            <code className="bg-secondary px-1 mx-0.5">{`{{staff_name}}`}</code>
            <code className="bg-secondary px-1 mx-0.5">{`{{next_suggested_menu}}`}</code>
          </p>

          <div className="border border-border bg-secondary/20 p-3 space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox checked={skipRecent} onCheckedChange={(v) => setSkipRecent(!!v)} />
              <span className="text-xs">直近に配信済みのお客様には再送しない（クールダウン）</span>
            </label>
            {skipRecent && (
              <div className="flex items-center gap-2 pl-6">
                <span className="text-[11px] text-muted-foreground">過去</span>
                <Input
                  type="number" min={1} max={90}
                  value={skipDays}
                  onChange={(e) => setSkipDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                  className="rounded-none w-20 h-8 text-sm"
                />
                <span className="text-[11px] text-muted-foreground">日以内に配信した方をスキップ</span>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="rounded-none">キャンセル</Button>
          <Button onClick={send} disabled={sending} className="rounded-none bg-gold hover:bg-gold/90 text-foreground">
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
            <Users className="w-3 h-3 mr-1" />
            {serverPreview?.total ?? "—"}名へ送信
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkLineDialog;
