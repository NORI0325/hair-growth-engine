import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, AlertCircle, Calendar, User, Scissors, MessageSquare } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type Action = "approve" | "propose" | "reject";

interface ResolveResp {
  success: boolean;
  action: Action;
  already_used: boolean;
  request: any;
  salon_name: string;
  error?: string;
}

const ACTION_LABEL: Record<Action, string> = {
  approve: "予約を承認",
  propose: "別日時を提案",
  reject: "予約を却下",
};

const PATH_TO_ACTION: Record<string, Action> = {
  a: "approve",
  p: "propose",
  r: "reject",
};

export default function ReservationAction() {
  const { actionPath, token } = useParams<{ actionPath: string; token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ResolveResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const expectedAction = actionPath ? PATH_TO_ACTION[actionPath] : undefined;

  // フォーム state
  const aiCand = data?.request?.desired_date_candidates?.[0] || data?.request?.ai_parsed?.desiredDateCandidates?.[0];
  const [confirmedDate, setConfirmedDate] = useState("");
  const [confirmedTime, setConfirmedTime] = useState("");
  const [confirmedMenu, setConfirmedMenu] = useState("");
  const [extraMessage, setExtraMessage] = useState("");
  const [proposalMessage, setProposalMessage] = useState("");
  const [rejectMessage, setRejectMessage] = useState("");
  const [rejectReason, setRejectReason] = useState("満席");

  useEffect(() => {
    document.title = `予約${expectedAction ? ACTION_LABEL[expectedAction] : "操作"}`;
    const meta = document.querySelector('meta[name="robots"]') || (() => {
      const m = document.createElement("meta");
      m.setAttribute("name", "robots");
      document.head.appendChild(m);
      return m;
    })();
    meta.setAttribute("content", "noindex, nofollow");
  }, [expectedAction]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/reservation-action-resolve?token=${encodeURIComponent(token)}`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
        );
        const json: ResolveResp = await res.json();
        if (!res.ok || !json.success) {
          setError(json.error || "リンクが無効または期限切れです");
        } else {
          setData(json);
          // フォーム初期値
          if (json.request?.desired_date_candidates?.[0]?.date) {
            setConfirmedDate(json.request.desired_date_candidates[0].date);
          } else if (json.request?.ai_parsed?.desiredDateCandidates?.[0]?.date) {
            setConfirmedDate(json.request.ai_parsed.desiredDateCandidates[0].date);
          }
          const tr = json.request?.desired_date_candidates?.[0]?.timeRange || json.request?.ai_parsed?.desiredDateCandidates?.[0]?.timeRange;
          if (tr && /^\d{2}:\d{2}$/.test(tr)) setConfirmedTime(tr);
          setConfirmedMenu(json.request?.desired_menu || "");
          setProposalMessage(`ご希望の日時は誠に申し訳ございませんが、別日でのご相談をさせてください。\n例えば下記はいかがでしょうか：\n・\n・`);
        }
      } catch (e: any) {
        setError(e.message || "通信エラー");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const customerName = data?.request?.display_name || "お客様";
  const salonName = data?.salon_name || "サロン";
  const action = data?.action || expectedAction;

  const handleSubmit = async () => {
    if (!token || !action) return;
    if (action === "approve" && (!confirmedDate || !confirmedTime)) {
      toast.error("日付と時刻を入力してください");
      return;
    }
    if (action === "propose" && !proposalMessage.trim()) {
      toast.error("提案メッセージを入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const body: any = { token };
      if (action === "approve") {
        body.confirmed_date = confirmedDate;
        body.confirmed_time = confirmedTime.length === 5 ? confirmedTime : `${confirmedTime}:00`;
        body.confirmed_menu = confirmedMenu;
        if (extraMessage) body.extra_message = extraMessage;
      } else if (action === "propose") {
        body.proposal_message = proposalMessage;
      } else if (action === "reject") {
        body.rejection_reason = rejectReason;
        if (rejectMessage) body.reject_message = rejectMessage;
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/reservation-action-execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(`エラー: ${json.error || res.statusText}`);
      } else {
        setDone(true);
        toast.success("処理が完了しました");
      }
    } catch (e: any) {
      toast.error(e.message || "通信エラー");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full p-8 text-center rounded-none border-l-4 border-l-destructive">
          <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-3" />
          <p className="text-xs tracking-[0.3em] text-muted-foreground mb-2">ERROR</p>
          <h1 className="text-xl font-serif mb-3">リンクをご確認ください</h1>
          <p className="text-sm text-muted-foreground">{error || "予約情報が見つかりませんでした。"}</p>
          <p className="text-xs text-muted-foreground mt-4">
            ダッシュボードから操作してください。
          </p>
        </Card>
      </div>
    );
  }

  if (data.already_used || done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full p-8 text-center rounded-none border-l-4 border-l-primary">
          <CheckCircle2 className="w-12 h-12 mx-auto text-primary mb-3" />
          <p className="text-xs tracking-[0.3em] text-muted-foreground mb-2">COMPLETED</p>
          <h1 className="text-xl font-serif mb-3">処理は完了しています</h1>
          <p className="text-sm text-muted-foreground">
            このリンクは{done ? "ご利用いただきました" : "既に使用されています"}。
          </p>
          <Button
            className="mt-6 rounded-none"
            onClick={() => (window.location.href = "/reservations")}
          >
            ダッシュボードへ
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="text-center mb-6">
          <p className="text-xs tracking-[0.3em] text-muted-foreground mb-2">RESERVATION ACTION</p>
          <h1 className="text-2xl font-serif">{action ? ACTION_LABEL[action] : "予約操作"}</h1>
          <p className="text-xs text-muted-foreground mt-1">— {salonName} —</p>
        </div>

        {/* 予約情報 */}
        <Card className="p-5 rounded-none space-y-3 border-l-4 border-l-primary">
          <p className="text-xs tracking-widest text-muted-foreground">お客様情報</p>
          <div className="flex items-start gap-2 text-sm">
            <User className="w-4 h-4 mt-0.5 text-muted-foreground" />
            <span className="font-medium">{customerName}様</span>
          </div>
          {(aiCand?.date || aiCand?.timeRange) && (
            <div className="flex items-start gap-2 text-sm">
              <Calendar className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <span>ご希望: {aiCand.date || ""} {aiCand.timeRange || ""}</span>
            </div>
          )}
          {data.request.desired_menu && (
            <div className="flex items-start gap-2 text-sm">
              <Scissors className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <span>{data.request.desired_menu}</span>
            </div>
          )}
          {data.request.raw_message && (
            <div className="flex items-start gap-2 text-sm">
              <MessageSquare className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <span className="text-muted-foreground whitespace-pre-wrap">{data.request.raw_message.slice(0, 400)}</span>
            </div>
          )}
        </Card>

        {/* アクションフォーム */}
        <Card className="p-5 rounded-none space-y-4">
          {action === "approve" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cd" className="text-xs tracking-widest text-muted-foreground">日付</Label>
                  <Input id="cd" type="date" value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} className="rounded-none" />
                </div>
                <div>
                  <Label htmlFor="ct" className="text-xs tracking-widest text-muted-foreground">時刻</Label>
                  <Input id="ct" type="time" value={confirmedTime} onChange={(e) => setConfirmedTime(e.target.value)} className="rounded-none" />
                </div>
              </div>
              <div>
                <Label htmlFor="cm" className="text-xs tracking-widest text-muted-foreground">メニュー</Label>
                <Input id="cm" value={confirmedMenu} onChange={(e) => setConfirmedMenu(e.target.value)} className="rounded-none" />
              </div>
              <div>
                <Label htmlFor="em" className="text-xs tracking-widest text-muted-foreground">追加メッセージ（任意）</Label>
                <Textarea id="em" value={extraMessage} onChange={(e) => setExtraMessage(e.target.value)} className="rounded-none" rows={2} />
              </div>
            </>
          )}

          {action === "propose" && (
            <div>
              <Label htmlFor="pm" className="text-xs tracking-widest text-muted-foreground">提案メッセージ</Label>
              <Textarea id="pm" value={proposalMessage} onChange={(e) => setProposalMessage(e.target.value)} className="rounded-none" rows={6} />
              <p className="text-xs text-muted-foreground mt-1">このメッセージがそのままお客様にLINE送信されます。</p>
            </div>
          )}

          {action === "reject" && (
            <>
              <div>
                <Label htmlFor="rr" className="text-xs tracking-widest text-muted-foreground">却下理由（社内用）</Label>
                <Input id="rr" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="rounded-none" />
              </div>
              <div>
                <Label htmlFor="rm" className="text-xs tracking-widest text-muted-foreground">お客様への返信文（空欄の場合は定型文）</Label>
                <Textarea id="rm" value={rejectMessage} onChange={(e) => setRejectMessage(e.target.value)} className="rounded-none" rows={5} placeholder="（空欄の場合は満席のお詫び文を自動送信）" />
              </div>
            </>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-none"
            size="lg"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {action ? ACTION_LABEL[action] : "実行"}を確定
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            このリンクは1回限り有効です。実行後は無効になります。
          </p>
        </Card>
      </div>
    </div>
  );
}
