import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, MessageCircle, Mail, Smartphone, Sparkles, Users, Filter } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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

const ageGroupOf = (b: string | null | undefined): AgeGroup | null => {
  if (!b) return null;
  const d = new Date(b); if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  if (a < 20) return "teens";
  if (a < 30) return "20s";
  if (a < 40) return "30s";
  if (a < 50) return "40s";
  if (a < 60) return "50s";
  return "60s+";
};

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
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("サロンからのお知らせ");
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [useLine, setUseLine] = useState(true);
  const [useSms, setUseSms] = useState(false);
  const [useEmail, setUseEmail] = useState(false);
  const [skipRecent, setSkipRecent] = useState(true);
  const [skipDays, setSkipDays] = useState(7);

  // セグメント絞込み
  const [genders, setGenders] = useState<Gender[]>([]);
  const [ages, setAges] = useState<AgeGroup[]>([]);
  const [vipOnly, setVipOnly] = useState(false);
  const [daysMin, setDaysMin] = useState<string>("");
  const [daysMax, setDaysMax] = useState<string>("");
  const [menuKw, setMenuKw] = useState("");

  const toggle = <T,>(arr: T[], v: T): T[] => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  // ブラウザ側で絞込み後の対象数をプレビュー
  const filteredCount = useMemo(() => {
    return customers.filter((c) => {
      if (genders.length > 0 && !genders.includes((c.gender || "unknown") as Gender)) return false;
      if (ages.length > 0) {
        const ag = ageGroupOf(c.birthday);
        if (!ag || !ages.includes(ag)) return false;
      }
      if (vipOnly) {
        const isVip = (c.total_spent || 0) >= 150000 || (c.visit_count || 0) >= 15;
        if (!isVip) return false;
      }
      if (daysMin || daysMax) {
        const ds = c.last_visit_date ? Math.floor((Date.now() - new Date(c.last_visit_date).getTime()) / 86400000) : null;
        if (ds === null) return false;
        if (daysMin && ds < Number(daysMin)) return false;
        if (daysMax && ds > Number(daysMax)) return false;
      }
      // メニューキーワードはサーバー側で再フィルタ
      return true;
    }).length;
  }, [customers, genders, ages, vipOnly, daysMin, daysMax]);

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
    // セグメントも自動セット
    if (k === "female-30s") { setGenders(["female"]); setAges(["30s"]); setVipOnly(false); }
    if (k === "male") { setGenders(["male"]); setAges([]); setVipOnly(false); }
    if (k === "vip") { setGenders([]); setAges([]); setVipOnly(true); }
    if (k === "dormant") { setGenders([]); setAges([]); setVipOnly(false); setDaysMin("180"); setDaysMax(""); }
    toast.success(`「${p.label}」テンプレを適用しました`);
  };

  const aiSuggest = async () => {
    setAiLoading(true);
    const segDesc: string[] = [];
    if (genders.length) segDesc.push(`性別: ${genders.join("/")}`);
    if (ages.length) segDesc.push(`年代: ${ages.join("/")}`);
    if (vipOnly) segDesc.push("VIPのみ");
    if (daysMin || daysMax) segDesc.push(`最終来店: ${daysMin || "0"}〜${daysMax || "∞"}日`);
    if (menuKw) segDesc.push(`前回メニュー: ${menuKw}を含む`);
    const segText = segDesc.length ? segDesc.join(" / ") : "全顧客";
    const prompt = `美容サロンの一斉送信文面を作成してください。\n\n対象セグメント: ${segText}\n対象人数: ${filteredCount}名\n\n要件:\n- {{name}} {{last_menu}} {{days_since}} {{staff_name}} {{next_suggested_menu}} の変数を活用\n- 特別感とパーソナル感を出す\n- 具体的なオファー（割引/メニュー）を含める\n- LINE/メール両対応で250文字以内\n- 押し付けがましくなく、自然で温かみのある日本語\n\n本文のみ返してください（前置きや説明は不要）。`;
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

  const send = async () => {
    if (message.trim().length < 2) { toast.error("メッセージを入力してください"); return; }
    if (!useLine && !useSms && !useEmail) { toast.error("送信チャネルを選択してください"); return; }
    setSending(true);
    const channels: string[] = [];
    if (useLine) channels.push("line");
    if (useSms) channels.push("sms");
    if (useEmail) channels.push("email");
    const { data, error } = await supabase.functions.invoke("bulk-broadcast", {
      body: {
        message, subject, channels,
        customer_ids: customers.map((c) => c.id),
        skip_recent_days: skipRecent ? skipDays : 0,
        segment: {
          genders, age_groups: ages,
          days_since_min: daysMin ? Number(daysMin) : null,
          days_since_max: daysMax ? Number(daysMax) : null,
          vip_only: vipOnly,
          menu_keyword: menuKw || null,
        },
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
    const seg = d?.segment_skipped || 0;
    const cs = d?.cooldown_skipped || 0;
    const skipMsg = [
      seg > 0 ? `セグメント外${seg}名` : "",
      cs > 0 ? `クールダウン${cs}名` : "",
    ].filter(Boolean).join(" ／ ");
    toast.success(`送信完了: ${parts.join(" · ")}${skipMsg ? ` ／ ${skipMsg}スキップ` : ""}`);
    setMessage("");
    onClose();
  };

  const preview = customers.slice(0, 5).map((c) => c.full_name).join(" / ")
    + (customers.length > 5 ? ` 他${customers.length - 5}名` : "");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Send className="w-4 h-4 text-gold" />
            一斉送信
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="eyebrow text-[10px]">— Recipients —</p>
              <p className="text-[10px] text-muted-foreground">
                選択 <span className="font-serif-en text-foreground">{customers.length}</span> ／ 絞込後 <span className="font-serif-en text-gold">{filteredCount}</span> 名
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{preview}</p>
          </div>

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
            <p className="eyebrow text-[10px] flex items-center gap-1.5"><Filter className="w-3 h-3" />— 配信前の絞込み —</p>

            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">性別</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["female","male","other","unknown"] as Gender[]).map((g) => (
                  <button key={g} type="button" onClick={() => setGenders(toggle(genders, g))}
                    className={`px-2.5 py-1 text-[11px] border ${genders.includes(g) ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>
                    {g === "female" ? "女性" : g === "male" ? "男性" : g === "other" ? "その他" : "未設定"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">年代</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["teens","20s","30s","40s","50s","60s+"] as AgeGroup[]).map((a) => (
                  <button key={a} type="button" onClick={() => setAges(toggle(ages, a))}
                    className={`px-2.5 py-1 text-[11px] border ${ages.includes(a) ? "bg-gold/10 border-gold text-gold" : "border-border hover:bg-secondary"}`}>
                    {a === "teens" ? "10代" : a === "60s+" ? "60代+" : a}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">最終来店からの日数</p>
                <div className="flex items-center gap-1.5">
                  <Input type="number" placeholder="最小" value={daysMin} onChange={(e) => setDaysMin(e.target.value)} className="rounded-none h-8 text-xs" />
                  <span className="text-[10px] text-muted-foreground">〜</span>
                  <Input type="number" placeholder="最大" value={daysMax} onChange={(e) => setDaysMax(e.target.value)} className="rounded-none h-8 text-xs" />
                  <span className="text-[10px] text-muted-foreground">日</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">前回メニューに含む</p>
                <Input placeholder="例: カラー" value={menuKw} onChange={(e) => setMenuKw(e.target.value)} className="rounded-none h-8 text-xs" />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={vipOnly} onCheckedChange={(v) => setVipOnly(!!v)} />
              <span className="text-[11px]">VIP（Gold以上）のみに絞る</span>
            </label>
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
            最大{filteredCount}名へ送信
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkLineDialog;
