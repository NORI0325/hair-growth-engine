import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TEMPLATE_CATALOG } from "@/lib/templateCatalog";
import { TrendingUp, Mail, MessageCircle, JapaneseYen, MousePointerClick, Gift } from "lucide-react";

const INCENTIVE_KIND_LABELS: Record<string, string> = {
  gift: "🎁 ギフト",
  service_addon: "✨ サービス追加",
  upgrade: "💎 アップグレード",
  priority: "👑 優先予約",
  experience: "🌿 体験メニュー",
  discount: "💝 割引",
  other: "その他",
};

interface IncentiveStat {
  id: string;
  kind: string;
  title: string;
  estimated_cost: number;
  sent: number;
  bookings: number;
  revenue: number;
}

const Performance = () => {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [emailStats, setEmailStats] = useState<Record<string, { sent: number; failed: number }>>({});
  const [lineStats, setLineStats] = useState<Record<string, { sent: number; failed: number }>>({});
  const [bookingsByTemplate, setBookingsByTemplate] = useState<Record<string, { count: number; revenue: number }>>({});
  const [incentiveStats, setIncentiveStats] = useState<IncentiveStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    Promise.all([
      // メール統計（dedup by message_id, latest）
      supabase
        .from("email_send_log")
        .select("message_id, template_name, status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      // LINE統計
      supabase
        .from("line_message_log")
        .select("job_type, status")
        .eq("owner_id", user.id)
        .gte("created_at", since),
      // 予約 by source_template
      supabase
        .from("bookings")
        .select("source_template, revenue")
        .eq("owner_id", user.id)
        .not("source_template", "is", null)
        .gte("created_at", since),
    ]).then(([emailRes, lineRes, bookingsRes]) => {
      // dedup email
      const seen = new Set<string>();
      const emap: Record<string, { sent: number; failed: number }> = {};
      (emailRes.data || []).forEach((r: any) => {
        if (!r.message_id || seen.has(r.message_id)) return;
        seen.add(r.message_id);
        const k = r.template_name;
        if (!emap[k]) emap[k] = { sent: 0, failed: 0 };
        if (r.status === "sent") emap[k].sent++;
        else if (["failed", "dlq", "bounced"].includes(r.status)) emap[k].failed++;
      });
    Promise.all([
      // メール統計（dedup by message_id, latest）
      supabase
        .from("email_send_log")
        .select("message_id, template_name, status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      // LINE統計
      supabase
        .from("line_message_log")
        .select("job_type, template_key, status")
        .eq("owner_id", user.id)
        .gte("created_at", since),
      // 予約 by source_template
      supabase
        .from("bookings")
        .select("source_template, revenue")
        .eq("owner_id", user.id)
        .not("source_template", "is", null)
        .gte("created_at", since),
      // 特典マスタ
      supabase
        .from("incentives")
        .select("id, kind, title, estimated_cost")
        .eq("owner_id", user.id),
      // テンプレ上書き → どのテンプレに何の特典が紐づいているか
      supabase
        .from("template_overrides")
        .select("template_key, channel, incentive_id")
        .eq("owner_id", user.id)
        .not("incentive_id", "is", null),
    ]).then(([emailRes, lineRes, bookingsRes, incRes, ovRes]) => {
      // dedup email
      const seen = new Set<string>();
      const emap: Record<string, { sent: number; failed: number }> = {};
      (emailRes.data || []).forEach((r: any) => {
        if (!r.message_id || seen.has(r.message_id)) return;
        seen.add(r.message_id);
        const k = r.template_name;
        if (!emap[k]) emap[k] = { sent: 0, failed: 0 };
        if (r.status === "sent") emap[k].sent++;
        else if (["failed", "dlq", "bounced"].includes(r.status)) emap[k].failed++;
      });
      setEmailStats(emap);

      const lmap: Record<string, { sent: number; failed: number }> = {};
      const lineByTemplate: Record<string, number> = {};
      (lineRes.data || []).forEach((r: any) => {
        const k = r.job_type;
        if (!lmap[k]) lmap[k] = { sent: 0, failed: 0 };
        if (r.status === "sent") lmap[k].sent++;
        else lmap[k].failed++;
        const tk = r.template_key || r.job_type;
        if (r.status === "sent") lineByTemplate[tk] = (lineByTemplate[tk] || 0) + 1;
      });
      setLineStats(lmap);

      const bmap: Record<string, { count: number; revenue: number }> = {};
      (bookingsRes.data || []).forEach((r: any) => {
        const k = r.source_template;
        if (!bmap[k]) bmap[k] = { count: 0, revenue: 0 };
        bmap[k].count++;
        bmap[k].revenue += r.revenue || 0;
      });
      setBookingsByTemplate(bmap);

      // 特典別集計：incentive_id → 紐づくtemplate_keyリスト → そのキーの送信数/予約数を足し上げ
      const incentives = incRes.data || [];
      const overrides = ovRes.data || [];
      const incToKeys: Record<string, Set<string>> = {};
      overrides.forEach((o: any) => {
        if (!o.incentive_id || !o.template_key) return;
        if (!incToKeys[o.incentive_id]) incToKeys[o.incentive_id] = new Set();
        incToKeys[o.incentive_id].add(o.template_key);
      });
      const istats: IncentiveStat[] = incentives.map((inc: any) => {
        const keys = Array.from(incToKeys[inc.id] || []);
        let sent = 0, bookings = 0, revenue = 0;
        keys.forEach((k) => {
          sent += (emap[k]?.sent || 0) + (lineByTemplate[k] || 0);
          bookings += bmap[k]?.count || 0;
          revenue += bmap[k]?.revenue || 0;
        });
        return {
          id: inc.id,
          kind: inc.kind || "other",
          title: inc.title,
          estimated_cost: inc.estimated_cost || 0,
          sent, bookings, revenue,
        };
      });
      setIncentiveStats(istats);

      setLoading(false);
    });
  }, [user, days]);

  const totals = useMemo(() => {
    let emailSent = 0, lineSent = 0, bookingCount = 0, revenue = 0;
    Object.values(emailStats).forEach((s) => emailSent += s.sent);
    Object.values(lineStats).forEach((s) => lineSent += s.sent);
    Object.values(bookingsByTemplate).forEach((s) => { bookingCount += s.count; revenue += s.revenue; });
    return { emailSent, lineSent, bookingCount, revenue };
  }, [emailStats, lineStats, bookingsByTemplate]);

  // 特典タイプ別の集計
  const incentiveByKind = useMemo(() => {
    const map: Record<string, { sent: number; bookings: number; revenue: number; cost: number; count: number }> = {};
    incentiveStats.forEach((s) => {
      const k = s.kind;
      if (!map[k]) map[k] = { sent: 0, bookings: 0, revenue: 0, cost: 0, count: 0 };
      map[k].sent += s.sent;
      map[k].bookings += s.bookings;
      map[k].revenue += s.revenue;
      map[k].cost += s.estimated_cost * s.bookings;
      map[k].count += 1;
    });
    return Object.entries(map)
      .map(([kind, v]) => ({
        kind,
        ...v,
        cvr: v.sent > 0 ? (v.bookings / v.sent) * 100 : 0,
        roi: v.cost > 0 ? ((v.revenue - v.cost) / v.cost) * 100 : (v.revenue > 0 ? 999 : 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [incentiveStats]);

  const rows = useMemo(() => {
    return TEMPLATE_CATALOG
      .map((t) => {
        const e = emailStats[t.key] || { sent: 0, failed: 0 };
        const l = lineStats[t.key] || { sent: 0, failed: 0 };
        const b = bookingsByTemplate[t.key] || { count: 0, revenue: 0 };
        const totalSent = e.sent + l.sent;
        const cvr = totalSent > 0 ? (b.count / totalSent) * 100 : 0;
        return { ...t, e, l, b, totalSent, cvr };
      })
      .filter((r) => r.totalSent > 0 || r.b.count > 0)
      .sort((a, b) => b.b.revenue - a.b.revenue);
  }, [emailStats, lineStats, bookingsByTemplate]);

  return (
    <AppLayout>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="eyebrow text-[10px] mb-3">PERFORMANCE · 効果測定</div>
          <h1 className="font-serif text-4xl text-foreground">配信効果ダッシュボード</h1>
          <p className="text-sm text-muted-foreground mt-2">テンプレート別のROIを可視化</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">過去7日</SelectItem>
            <SelectItem value="30">過去30日</SelectItem>
            <SelectItem value="90">過去90日</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Mail className="w-3 h-3" /> メール送信</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-serif">{totals.emailSent.toLocaleString()}</div></CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><MessageCircle className="w-3 h-3" /> LINE送信</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-serif">{totals.lineSent.toLocaleString()}</div></CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><MousePointerClick className="w-3 h-3" /> 予約転換</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-serif">{totals.bookingCount.toLocaleString()}</div></CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><JapaneseYen className="w-3 h-3" /> 売上貢献</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-serif">¥{totals.revenue.toLocaleString()}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> テンプレート別パフォーマンス</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">読み込み中...</div> :
            rows.length === 0 ? <div className="text-sm text-muted-foreground">配信実績がまだありません</div> :
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left py-2">テンプレート</th>
                    <th className="text-right">メール</th>
                    <th className="text-right">LINE</th>
                    <th className="text-right">予約</th>
                    <th className="text-right">転換率</th>
                    <th className="text-right">売上</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b">
                      <td className="py-2">{r.displayName}</td>
                      <td className="text-right">{r.e.sent}{r.e.failed > 0 && <span className="text-red-500 text-xs ml-1">({r.e.failed}失敗)</span>}</td>
                      <td className="text-right">{r.l.sent}{r.l.failed > 0 && <span className="text-red-500 text-xs ml-1">({r.l.failed}失敗)</span>}</td>
                      <td className="text-right">{r.b.count}</td>
                      <td className="text-right">
                        <Badge variant={r.cvr >= 10 ? "default" : "outline"}>{r.cvr.toFixed(1)}%</Badge>
                      </td>
                      <td className="text-right font-medium">¥{r.b.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </CardContent>
      </Card>
    </AppLayout>
  );
};

export default Performance;
