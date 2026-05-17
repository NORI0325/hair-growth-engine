import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AlertTriangle, CheckCheck, FileSearch, GitCompare, AlertCircle, MapPinOff, Send, Download, CalendarDays, RefreshCw, ExternalLink, ChevronDown, ChevronRight, StopCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import SyncStatusDialog from "@/components/SyncStatusDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  external_missing: { text: "サロンボードに無い", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  local_missing:    { text: "アプリに無い",       tone: "bg-amber-50 text-amber-800 border-amber-200" },
  conflict:         { text: "差異あり",            tone: "bg-red-50 text-red-700 border-red-200" },
  failed:           { text: "同期失敗",            tone: "bg-red-50 text-red-700 border-red-200" },
  needs_review:     { text: "要確認",              tone: "bg-red-50 text-red-700 border-red-200" },
};

interface Row {
  id: string;
  booking_date: string;
  booking_time: string;
  menu: string;
  status: string;
  staff_id: string | null;
  customer_id: string;
  location_id: string | null;
  external_reservation_id: string | null;
  external_source: string | null;
  source_channel: string | null;
  sync_status: string;
  last_sync_error: string | null;
  sync_error_message: string | null;
  last_synced_at: string | null;
  needs_manual_review: boolean;
  customers: { full_name: string | null } | null;
  staff: { name: string | null } | null;
  // 結合用
  latest_snapshot?: { id: string; result: string; reason: string | null; checked_at: string; diff: any; local_payload: any; external_payload: any } | null;
  latest_job?: { id: string; status: string; error_type: string | null; error_message: string | null; updated_at: string; job_type: string } | null;
}

interface InboundLog {
  id: string;
  source: string;
  raw_subject: string | null;
  raw_from: string | null;
  status: string;
  error: string | null;
  parsed_data: any;
  created_booking_id: string | null;
  created_at: string;
}

interface DayItem {
  external_reservation_id: string | null;
  date: string;
  time: string | null;
  customerName: string | null;
  menu: string | null;
  stylistName: string | null;
  classification: "matched" | "salonboard_only" | "conflict";
  matched_booking_id?: string | null;
  reason?: string;
}

export default function SyncReview() {
  const { user } = useAuth();
  const currentLocationId = useCurrentLocationId();
  const [items, setItems] = useState<Row[]>([]);
  const [inboundLogs, setInboundLogs] = useState<InboundLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncTarget, setSyncTarget] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<Row | null>(null);
  const [errorTarget, setErrorTarget] = useState<Row | null>(null);
  const [inboundDetail, setInboundDetail] = useState<InboundLog | null>(null);

  // サロンボード予約表チェック
  const today = new Date().toISOString().slice(0, 10);
  const [dayDate, setDayDate] = useState<string>(today);
  const [rangeDays, setRangeDays] = useState<"1" | "7" | "14" | "30">("1");
  const [dayLoading, setDayLoading] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);

  // 範囲取得の進捗（1日でも同じ構造で持つ）
  type DayResult = {
    date: string;
    state: "pending" | "running" | "done" | "failed" | "skipped";
    items?: DayItem[];
    total_external?: number;
    total_local?: number;
    error?: string;
    error_type?: string | null;
  };
  const [rangeResults, setRangeResults] = useState<DayResult[]>([]);
  const [rangeProgress, setRangeProgress] = useState<{ current: number; total: number } | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  const load = async () => {
    if (!user) return;
    setLoading(true);

    // bookings: sync_status が要確認 or location_id NULL（カレンダー欠落事故防止）
    const { data: bookings } = await supabase
      .from("bookings")
      .select(`
        id, booking_date, booking_time, menu, status, staff_id, customer_id, location_id,
        external_reservation_id, external_source, source_channel,
        sync_status, last_sync_error, sync_error_message, last_synced_at, needs_manual_review,
        customers:customer_id(full_name),
        staff:staff_id(name)
      `)
      .eq("owner_id", user.id)
      .or(
        "sync_status.in.(external_missing,local_missing,conflict,failed,needs_review),location_id.is.null,needs_manual_review.eq.true",
      )
      .gte("booking_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
      .order("booking_date", { ascending: false })
      .limit(200);

    const rows: Row[] = (bookings as any) ?? [];
    const ids = rows.map((r) => r.id);

    // 最新スナップショット & 最新 sync_job を取得
    let snapMap: Record<string, any> = {};
    let jobMap: Record<string, any> = {};
    if (ids.length > 0) {
      const [snap, job] = await Promise.all([
        supabase.from("sync_diff_snapshots")
          .select("id, booking_id, result, reason, checked_at, diff, local_payload, external_payload")
          .in("booking_id", ids)
          .order("checked_at", { ascending: false }),
        supabase.from("sync_jobs")
          .select("id, reservation_id, status, error_type, error_message, updated_at, job_type")
          .in("reservation_id", ids)
          .order("updated_at", { ascending: false }),
      ]);
      for (const s of (snap.data ?? []) as any[]) {
        if (!snapMap[s.booking_id]) snapMap[s.booking_id] = s;
      }
      for (const j of (job.data ?? []) as any[]) {
        if (!jobMap[j.reservation_id]) jobMap[j.reservation_id] = j;
      }
    }

    setItems(rows.map((r) => ({ ...r, latest_snapshot: snapMap[r.id] ?? null, latest_job: jobMap[r.id] ?? null })));

    // 外部通知メール取り込みの needs_review もここに統合表示
    const { data: logs } = await supabase
      .from("external_reservation_logs" as any)
      .select("id, source, raw_subject, raw_from, status, error, parsed_data, created_booking_id, created_at")
      .eq("owner_id", user.id)
      .eq("status", "needs_review")
      .order("created_at", { ascending: false })
      .limit(100);
    setInboundLogs((logs as any) ?? []);

    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const markResolved = async (b: Row) => {
    if (!confirm("この予約を「確認済み」にします。よろしいですか？")) return;
    await supabase.from("bookings").update({
      needs_manual_review: false,
      sync_status: "not_required",
    }).eq("id", b.id);
    if (b.latest_job?.id && (b.latest_job.status === "failed" || b.latest_job.status === "needs_review")) {
      await supabase.from("sync_jobs").update({ status: "cancelled", error_message: "管理者により確認済み" }).eq("id", b.latest_job.id);
    }
    toast.success("確認済みにしました");
    load();
  };

  const resendOne = async (b: Row) => {
    if (!confirm(`「${b.customers?.full_name ?? "顧客"}」${b.booking_date} ${b.booking_time?.slice(0,5)} の予約をサロンボードへ再送信します。\n\n直前にサロンボード側を再照合し、外部に予約が無い場合のみ送信します。\n候補が見つかった場合は二重予約防止のため送信を中止します。\n\n実行しますか？`)) return;
    const { data: res, error } = await supabase.functions.invoke("sync-resend-to-salonboard", { body: { booking_id: b.id } });
    if (error) { toast.error("再送信失敗: " + error.message); return; }
    const r: any = res;
    if (r?.action === "enqueued") toast.success(r.message);
    else if (r?.action === "refused") toast.warning(r.message);
    else if (r?.action === "skipped") toast.info(r.message);
    else if (r?.error) toast.error(r.message ?? r.error);
    load();
  };

  // 1日分を取得（既存Edgeを呼び出すだけ・破壊変更なし）
  const fetchOneDay = async (date: string): Promise<DayResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("salonboard-fetch-day-reservations", {
        body: { date, location_id: currentLocationId },
      });
      if (error) {
        return { date, state: "failed", error: error.message, error_type: "invoke_error" };
      }
      const r: any = data;
      if (!r?.success) {
        const msg: string = r?.message || r?.error || "unknown";
        const looksCaptcha = /captcha/i.test(msg) || r?.error === "captcha_required" || /captcha/i.test(r?.error_type || "");
        return {
          date, state: "failed",
          error: msg,
          error_type: looksCaptcha ? "captcha_required" : (r?.error || "worker_failed"),
        };
      }
      return {
        date, state: "done",
        items: r.items as DayItem[],
        total_external: r.total_external,
        total_local: r.total_local,
      };
    } catch (e: any) {
      return { date, state: "failed", error: e?.message || String(e), error_type: "exception" };
    }
  };

  const addDays = (yyyymmdd: string, n: number): string => {
    const d = new Date(yyyymmdd + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const fetchRange = async () => {
    if (!dayDate) return;
    const total = parseInt(rangeDays, 10);
    const dates: string[] = [];
    for (let i = 0; i < total; i++) dates.push(addDays(dayDate, i));

    setDayLoading(true);
    setStopRequested(false);
    setStopReason(null);
    setRangeProgress({ current: 0, total });
    setExpandedDates({ [dates[0]]: true });
    setRangeResults(dates.map((d) => ({ date: d, state: "pending" })));

    let consecutiveFailures = 0;
    let stoppedEarly = false;
    let stopMsg: string | null = null;

    for (let i = 0; i < dates.length; i++) {
      // 最新の stopRequested を関数 setter 経由で取り出す（closure 古値対策）
      let latestStop = false;
      setStopRequested((s) => { latestStop = s; return s; });
      if (latestStop) {
        stoppedEarly = true;
        stopMsg = "ユーザーが取得を停止しました。";
        break;
      }

      const d = dates[i];
      setRangeResults((prev) => prev.map((r) => r.date === d ? { ...r, state: "running" } : r));
      setRangeProgress({ current: i + 1, total });

      const result = await fetchOneDay(d);
      setRangeResults((prev) => prev.map((r) => r.date === d ? result : r));

      if (result.state === "failed") {
        consecutiveFailures += 1;
        if (result.error_type === "captcha_required") {
          stoppedEarly = true;
          stopMsg = "サロンボード側で確認が必要な可能性があります（captcha_required）。残りの日付の取得を中止しました。";
          break;
        }
        if (consecutiveFailures >= 2) {
          stoppedEarly = true;
          stopMsg = "連続2日取得に失敗したため、残りの日付の取得を中止しました。";
          break;
        }
      } else {
        consecutiveFailures = 0;
      }

      // サロンボード負荷軽減のため800ms待機（最終日は不要）
      if (i < dates.length - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    setRangeResults((prev) => prev.map((r) => (r.state === "pending" || r.state === "running") ? { ...r, state: "skipped" } : r));
    setDayLoading(false);
    setRangeProgress(null);
    if (stoppedEarly && stopMsg) setStopReason(stopMsg);

    setRangeResults((prev) => {
      const done = prev.filter((r) => r.state === "done").length;
      const failed = prev.filter((r) => r.state === "failed").length;
      if (stoppedEarly) toast.warning(`取得を中止しました（成功${done}日 / 失敗${failed}日）`);
      else if (failed > 0) toast.warning(`取得完了：成功${done}日 / 失敗${failed}日`);
      else toast.success(`${done}日分の予約表を取得しました`);
      return prev;
    });
  };

  const importItem = async (it: DayItem, sourceDate: string) => {
    if (!it.customerName) {
      toast.error("顧客名が取得できなかったため取り込めません。");
      return;
    }
    if (!it.time) {
      toast.error(
        "時刻が取得できなかったため取り込めません。サロンボード画面で時刻表示が変則の可能性があります。サロンボードを開いて時刻を確認後、SalonBoostでは手動予約として登録してください。",
        { duration: 8000 },
      );
      return;
    }
    const key = `${it.external_reservation_id ?? ""}|${it.customerName}|${it.time}`;
    setImportingKey(key);
    try {
      const { data, error } = await supabase.functions.invoke("salonboard-import-reservation", {
        body: {
          date: sourceDate,
          time: it.time,
          customer_name: it.customerName,
          menu: it.menu,
          external_reservation_id: it.external_reservation_id,
          location_id: currentLocationId,
        },
      });
      if (error) { toast.error("取り込み失敗: " + error.message); return; }
      const r: any = data;
      if (r?.success) {
        if (r.action === "skipped") toast.info(r.message || "既に存在するためスキップしました");
        else toast.success("SalonBoost に取り込みました");
        // 対象日のみ再取得
        const refreshed = await fetchOneDay(sourceDate);
        setRangeResults((prev) => prev.map((x) => x.date === sourceDate ? refreshed : x));
        await load();
      } else {
        toast.error("取り込み失敗: " + (r?.message || r?.error || "unknown"));
      }
    } catch (e: any) {
      toast.error("取り込み失敗: " + (e?.message || String(e)));
    } finally {
      setImportingKey(null);
    }
  };

  const totals = (() => {
    let ext = 0, loc = 0, matched = 0, only = 0, conflict = 0, doneDays = 0, failedDays = 0;
    for (const r of rangeResults) {
      if (r.state === "done") {
        doneDays++;
        ext += r.total_external ?? 0;
        loc += r.total_local ?? 0;
        for (const it of (r.items ?? [])) {
          if (it.classification === "matched") matched++;
          else if (it.classification === "salonboard_only") only++;
          else if (it.classification === "conflict") conflict++;
        }
      } else if (r.state === "failed") {
        failedDays++;
      }
    }
    return { ext, loc, matched, only, conflict, doneDays, failedDays };
  })();

  return (
    <div className="container max-w-6xl py-12 px-6">
      <div className="mb-10">
        <div className="text-[10px] tracking-luxury text-gold mb-2">SYNC REVIEW</div>
        <h1 className="font-serif text-3xl mb-2">同期エラー一覧</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          サロンボードへの同期に失敗した予約、差異が検出された予約、店舗未割当の予約をまとめて確認できます。<br />
          <span className="text-amber-700">第3段階：再送信は直前照合付き、取り込みは external_reservation_id 重複防止付き、競合は管理者判断のみ。自動上書きは行いません。</span>
        </p>
      </div>

      {/* サロンボード予約表チェック */}
      <Card className="rounded-none p-5 mb-8 border-l-4 border-l-gold">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <div className="text-[10px] tracking-luxury text-gold mb-1">SALONBOARD DAILY CHECK</div>
            <h2 className="font-serif text-lg">サロンボード予約表を確認</h2>
            <p className="text-xs text-muted-foreground mt-1">
              サロンボードに直接入力された予約（メール通知では拾えない予約）を、指定日から最大1ヶ月分まで日別に取得し SalonBoost と差分照合します。サロンボード負荷軽減のため1日ずつ直列取得します。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <Input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} className="w-44 rounded-none" disabled={dayLoading} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">取得範囲</span>
            <Select value={rangeDays} onValueChange={(v) => setRangeDays(v as any)} disabled={dayLoading}>
              <SelectTrigger className="w-40 rounded-none h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1日</SelectItem>
                <SelectItem value="7">7日間（推奨）</SelectItem>
                <SelectItem value="14">14日間</SelectItem>
                <SelectItem value="30">1ヶ月</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchRange} disabled={dayLoading || !dayDate} className="rounded-none">
            {dayLoading ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <FileSearch className="w-3 h-3 mr-1" />}
            予約表を取得
          </Button>
          {dayLoading && (
            <Button variant="outline" size="sm" className="rounded-none" onClick={() => setStopRequested(true)}>
              <StopCircle className="w-3 h-3 mr-1" />停止
            </Button>
          )}
        </div>

        {rangeDays === "30" && (
          <div className="mt-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">
            1ヶ月取得はサロンボード側の確認画面やCAPTCHAが出る可能性があります。まずは7日間取得を推奨します。
          </div>
        )}
        {rangeDays === "14" && (
          <div className="mt-3 text-[11px] text-amber-700">
            14日間は7日間より時間がかかります。途中で停止できます。
          </div>
        )}

        {rangeProgress && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            取得中: {rangeProgress.current} / {rangeProgress.total} 日目
          </div>
        )}

        {rangeResults.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-7 gap-2 text-[11px]">
              <SummaryStat label="成功日数" value={totals.doneDays} />
              <SummaryStat label="失敗日数" value={totals.failedDays} tone={totals.failedDays > 0 ? "warn" : undefined} />
              <SummaryStat label="サロンボード" value={totals.ext} />
              <SummaryStat label="SalonBoost" value={totals.loc} />
              <SummaryStat label="一致" value={totals.matched} />
              <SummaryStat label="サロンボードのみ" value={totals.only} tone={totals.only > 0 ? "warn" : undefined} />
              <SummaryStat label="競合" value={totals.conflict} tone={totals.conflict > 0 ? "alert" : undefined} />
            </div>

            {stopReason && (
              <div className="mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 px-3 py-2">
                {stopReason}
              </div>
            )}

            <div className="mt-4 space-y-2">
              {rangeResults.map((r) => {
                const onlyCount = (r.items ?? []).filter((it) => it.classification === "salonboard_only").length;
                const conflictCount = (r.items ?? []).filter((it) => it.classification === "conflict").length;
                const matchedCount = (r.items ?? []).filter((it) => it.classification === "matched").length;
                const needsAttention = onlyCount > 0 || conflictCount > 0 || r.state === "failed";
                const headerTone =
                  r.state === "failed" ? "border-l-red-500 bg-red-50/40" :
                  needsAttention ? "border-l-amber-500 bg-amber-50/40" :
                  r.state === "done" ? "border-l-emerald-500 bg-emerald-50/30" :
                  r.state === "running" ? "border-l-blue-500 bg-blue-50/30" :
                  "border-l-muted bg-muted/20";
                const isOpen = !!expandedDates[r.date];
                return (
                  <Collapsible key={r.date} open={isOpen} onOpenChange={(o) => setExpandedDates((p) => ({ ...p, [r.date]: o }))}>
                    <CollapsibleTrigger asChild>
                      <button className={`w-full text-left border-l-4 ${headerTone} px-3 py-2 flex items-center justify-between gap-3 flex-wrap hover:bg-muted/30`}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          <span className="font-serif text-sm">{r.date}</span>
                          {r.state === "running" && <Badge className="rounded-none text-[10px]" variant="outline"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />取得中</Badge>}
                          {r.state === "pending" && <Badge className="rounded-none text-[10px]" variant="outline">待機</Badge>}
                          {r.state === "skipped" && <Badge className="rounded-none text-[10px]" variant="outline">スキップ</Badge>}
                          {r.state === "failed" && <Badge className="rounded-none text-[10px] bg-red-50 text-red-700 border-red-200">失敗{r.error_type ? ` / ${r.error_type}` : ""}</Badge>}
                          {r.state === "done" && (
                            <span className="text-[11px] text-muted-foreground">
                              サロンボード {r.total_external ?? 0} ／ SalonBoost {r.total_local ?? 0}
                              {(onlyCount + conflictCount + matchedCount) > 0 && ` ／ 一致${matchedCount}・SBのみ${onlyCount}・競合${conflictCount}`}
                            </span>
                          )}
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 py-2 space-y-2">
                        {r.state === "failed" && (
                          <div className="text-xs text-red-700 bg-red-50 px-2 py-1">エラー: {r.error}</div>
                        )}
                        {r.state === "done" && (r.items?.length ?? 0) === 0 && (
                          <div className="text-sm text-muted-foreground py-2">サロンボード側の予約は見つかりませんでした</div>
                        )}
                        {(r.items ?? []).map((it, idx) => {
                          const tone =
                            it.classification === "matched" ? "border-l-emerald-500 bg-emerald-50/30" :
                            it.classification === "salonboard_only" ? "border-l-amber-500 bg-amber-50/30" :
                            "border-l-red-500 bg-red-50/30";
                          const labelText =
                            it.classification === "matched" ? "一致" :
                            it.classification === "salonboard_only" ? "サロンボードのみ" : "競合";
                          const key = `${it.external_reservation_id ?? ""}|${it.customerName}|${it.time}|${idx}`;
                          const sbDetailUrl = it.external_reservation_id
                            ? `https://salonboard.com/CLP/bt/reserve/reserveDetail/?reserveId=${encodeURIComponent(it.external_reservation_id)}`
                            : null;
                          const missingTimeOrName = !it.time || !it.customerName;
                          return (
                            <div key={key} className={`border-l-4 ${tone} px-3 py-2 flex items-center justify-between gap-3 flex-wrap`}>
                              <div className="text-sm flex-1 min-w-0">
                                <Badge className="rounded-none mr-2 text-[10px]" variant="outline">{labelText}</Badge>
                                <span className="font-serif">{it.customerName ?? "顧客不明"}</span>
                                <span className="text-muted-foreground"> ・ {it.time ?? "—"} ・ {it.menu ?? "メニュー不明"}</span>
                                <span className="text-[11px] text-muted-foreground"> ／ ext_id: {it.external_reservation_id ?? "—"}</span>
                                {it.reason && <span className="text-[11px] text-muted-foreground"> ／ {it.reason}</span>}
                                {sbDetailUrl && missingTimeOrName && (
                                  <a href={sbDetailUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-[11px] text-gold inline-flex items-center hover:underline">
                                    <ExternalLink className="w-3 h-3 mr-0.5" />サロンボード詳細を開く
                                  </a>
                                )}
                              </div>
                              {it.classification === "salonboard_only" && (
                                <Button
                                  size="sm" className="rounded-none"
                                  disabled={importingKey === `${it.external_reservation_id ?? ""}|${it.customerName}|${it.time}`}
                                  onClick={() => importItem(it, r.date)}
                                >
                                  <Download className="w-3 h-3 mr-1" />SalonBoost に取り込む
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </>
        )}
      </Card>


      {loading ? (
        <div className="text-center py-12 text-muted-foreground">読み込み中...</div>
      ) : items.length === 0 ? (
        <Card className="rounded-none p-12 text-center text-muted-foreground">
          <CheckCheck className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
          要確認の予約はありません
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((b) => {
            const label = STATUS_LABEL[b.sync_status] ?? null;
            const noLocation = !b.location_id;
            return (
              <Card key={b.id} className={`rounded-none border-l-4 ${noLocation ? "border-l-orange-500" : "border-l-red-500"} p-5`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {label && (
                        <Badge className={`rounded-none ${label.tone} border`}>
                          <AlertTriangle className="w-3 h-3 mr-1" />{label.text}
                        </Badge>
                      )}
                      {noLocation && (
                        <Badge className="rounded-none bg-orange-50 text-orange-800 border-orange-200">
                          <MapPinOff className="w-3 h-3 mr-1" />店舗未割当
                        </Badge>
                      )}
                      {b.needs_manual_review && (
                        <Badge className="rounded-none bg-secondary text-foreground border">手動確認待ち</Badge>
                      )}
                      {b.external_source && (
                        <Badge variant="outline" className="rounded-none text-[10px]">取込元: {b.external_source}</Badge>
                      )}
                    </div>

                    <div className="text-sm">
                      <span className="font-serif">{b.customers?.full_name ?? "顧客不明"}</span>
                      <span className="text-muted-foreground"> ・ {b.booking_date} {b.booking_time?.slice(0, 5)} ・ {b.menu}</span>
                      <span className="text-muted-foreground"> ・ 担当: {b.staff?.name ?? <em>未指定（フリー）</em>}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <Field k="sync_status" v={b.sync_status} />
                      <Field k="external_reservation_id" v={b.external_reservation_id ?? "—"} />
                      <Field k="最終同期" v={b.last_synced_at ? new Date(b.last_synced_at).toLocaleString("ja-JP") : "—"} />
                      <Field k="最終確認" v={b.latest_snapshot?.checked_at ? new Date(b.latest_snapshot.checked_at).toLocaleString("ja-JP") : "—"} />
                    </div>

                    {(b.last_sync_error || b.sync_error_message) && (
                      <div className="text-xs text-red-600 bg-red-50 px-2 py-1">
                        {b.last_sync_error || b.sync_error_message}
                      </div>
                    )}
                    {b.latest_job && (b.latest_job.error_type || b.latest_job.error_message) && (
                      <div className="text-[11px] text-muted-foreground">
                        ジョブ: {b.latest_job.job_type} / {b.latest_job.status}
                        {b.latest_job.error_type && ` / ${b.latest_job.error_type}`}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="rounded-none" onClick={() => setSyncTarget(b.id)}>
                      <FileSearch className="w-3 h-3 mr-1" />同期状態を確認
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-none" disabled={!b.latest_snapshot} onClick={() => setDiffTarget(b)} title={!b.latest_snapshot ? "先に「同期状態を確認」を実行してください" : ""}>
                      <GitCompare className="w-3 h-3 mr-1" />差分を確認
                    </Button>
                    {(b.sync_status === "external_missing" || b.latest_snapshot?.result === "local_only") && b.location_id && (
                      <Button size="sm" className="rounded-none" onClick={() => resendOne(b)}>
                        <Send className="w-3 h-3 mr-1" />サロンボードへ再送信
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="rounded-none" disabled={!(b.last_sync_error || b.sync_error_message || b.latest_job?.error_message)} onClick={() => setErrorTarget(b)}>
                      <AlertCircle className="w-3 h-3 mr-1" />エラー内容
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-none" onClick={() => markResolved(b)}>
                      <CheckCheck className="w-3 h-3 mr-1" />解消済みに
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {inboundLogs.length > 0 && (
        <div className="mt-12">
          <div className="text-[10px] tracking-luxury text-gold mb-2">INBOUND EMAIL — NEEDS REVIEW</div>
          <h2 className="font-serif text-xl mb-4">外部通知メール取り込み（要確認）</h2>
          <div className="space-y-2">
            {inboundLogs.map((l) => (
              <Card key={l.id} className="rounded-none border-l-4 border-l-amber-500 p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="rounded-none text-[10px]">{l.source}</Badge>
                      {l.error && <Badge className="rounded-none bg-amber-50 text-amber-800 border-amber-200 text-[10px]">{l.error}</Badge>}
                      <span className="text-[11px] text-muted-foreground">{new Date(l.created_at).toLocaleString("ja-JP")}</span>
                    </div>
                    <div className="text-sm font-serif truncate">{l.raw_subject ?? "(件名なし)"}</div>
                    <div className="text-[11px] text-muted-foreground truncate">from: {l.raw_from ?? "—"}</div>
                    {l.parsed_data && (
                      <div className="text-[11px] text-muted-foreground">
                        {l.parsed_data.customer_name ?? "—"} / {l.parsed_data.booking_date ?? "—"} {l.parsed_data.booking_time ?? ""} / ext_id: {l.parsed_data.external_reservation_id ?? "—"}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="rounded-none" onClick={() => setInboundDetail(l)}>
                      <FileSearch className="w-3 h-3 mr-1" />詳細
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-none" onClick={async () => {
                      if (!confirm("この通知を「確認済み」にします。よろしいですか？")) return;
                      await supabase.from("external_reservation_logs" as any).update({ status: "reviewed" }).eq("id", l.id);
                      toast.success("確認済みにしました");
                      load();
                    }}>
                      <CheckCheck className="w-3 h-3 mr-1" />確認済みに
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!inboundDetail} onOpenChange={(o) => !o && setInboundDetail(null)}>
        <DialogContent className="rounded-none max-w-2xl">
          <DialogHeader><DialogTitle className="font-serif">通知メール詳細</DialogTitle></DialogHeader>
          {inboundDetail && (
            <div className="space-y-3 text-sm">
              <Section title="メタ">
                <div className="text-[11px]">source: {inboundDetail.source} / status: {inboundDetail.status}</div>
                <div className="text-[11px]">from: {inboundDetail.raw_from} / 受信: {new Date(inboundDetail.created_at).toLocaleString("ja-JP")}</div>
                <div className="text-[11px]">件名: {inboundDetail.raw_subject}</div>
                {inboundDetail.error && <div className="text-[11px] text-amber-700">理由: {inboundDetail.error}</div>}
              </Section>
              <Section title="parsed_data (AI抽出)">
                <pre className="text-[11px] bg-muted p-2 overflow-auto max-h-60">{JSON.stringify(inboundDetail.parsed_data, null, 2)}</pre>
              </Section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {syncTarget && (
        <SyncStatusDialog
          bookingId={syncTarget}
          open={!!syncTarget}
          onOpenChange={(o) => { if (!o) { setSyncTarget(null); load(); } }}
        />
      )}

      {/* 差分表示ダイアログ */}
      <Dialog open={!!diffTarget} onOpenChange={(o) => !o && setDiffTarget(null)}>
        <DialogContent className="rounded-none max-w-3xl">
          <DialogHeader><DialogTitle className="font-serif">差分を確認</DialogTitle></DialogHeader>
          {diffTarget?.latest_snapshot ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                最終確認: {new Date(diffTarget.latest_snapshot.checked_at).toLocaleString("ja-JP")} ／ 結果: {diffTarget.latest_snapshot.result}
              </p>
              {diffTarget.latest_snapshot.reason && <p className="text-xs">{diffTarget.latest_snapshot.reason}</p>}
              <Section title="アプリ側 (local_payload)">
                <pre className="text-[11px] bg-muted p-2 overflow-auto max-h-60">{JSON.stringify(diffTarget.latest_snapshot.local_payload, null, 2)}</pre>
              </Section>
              <Section title="サロンボード側 (external_payload)">
                <pre className="text-[11px] bg-muted p-2 overflow-auto max-h-60">{JSON.stringify(diffTarget.latest_snapshot.external_payload, null, 2)}</pre>
              </Section>
              <p className="text-[11px] text-muted-foreground">※ 差分の解消（上書き／取込／再送信）は第3段階で手動操作付きで実装します。</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">スナップショットがありません。「同期状態を確認」を先に実行してください。</p>
          )}
        </DialogContent>
      </Dialog>

      {/* エラー詳細ダイアログ */}
      <Dialog open={!!errorTarget} onOpenChange={(o) => !o && setErrorTarget(null)}>
        <DialogContent className="rounded-none max-w-2xl">
          <DialogHeader><DialogTitle className="font-serif">エラー内容</DialogTitle></DialogHeader>
          {errorTarget && (
            <div className="space-y-3 text-sm">
              {errorTarget.last_sync_error && <Section title="last_sync_error"><pre className="text-[11px] bg-red-50 p-2 whitespace-pre-wrap">{errorTarget.last_sync_error}</pre></Section>}
              {errorTarget.sync_error_message && <Section title="sync_error_message"><pre className="text-[11px] bg-red-50 p-2 whitespace-pre-wrap">{errorTarget.sync_error_message}</pre></Section>}
              {errorTarget.latest_job?.error_message && (
                <Section title={`最新ジョブ: ${errorTarget.latest_job.job_type} / ${errorTarget.latest_job.status}`}>
                  <div className="text-[11px] text-muted-foreground mb-1">{errorTarget.latest_job.error_type ?? ""}</div>
                  <pre className="text-[11px] bg-muted p-2 whitespace-pre-wrap">{errorTarget.latest_job.error_message}</pre>
                </Section>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Field = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="truncate"><span className="text-[10px] uppercase tracking-luxury">{k}</span>: <span className="text-foreground">{v}</span></div>
);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-border p-2">
    <div className="eyebrow text-[10px] text-muted-foreground mb-1">{title}</div>
    {children}
  </div>
);
const SummaryStat = ({ label, value, tone }: { label: string; value: number; tone?: "warn" | "alert" }) => (
  <div className={`border px-2 py-1 ${tone === "alert" ? "border-red-200 bg-red-50 text-red-700" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-border bg-muted/20 text-foreground"}`}>
    <div className="text-[10px] uppercase tracking-luxury opacity-70">{label}</div>
    <div className="text-sm font-serif">{value}</div>
  </div>
);
