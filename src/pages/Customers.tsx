import { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { List, type RowComponentProps } from "react-window";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import AddCustomerDialog, { type AddedCustomer } from "@/components/AddCustomerDialog";
import EditCustomerDialog, { type EditableCustomer } from "@/components/EditCustomerDialog";
import PendingLineFriends from "@/components/PendingLineFriends";
import LineLinkQRDialog from "@/components/LineLinkQRDialog";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Pencil, FileText, QrCode, ArrowUpDown, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { calculateVipTier, tierInfo, isBirthdayMonth } from "@/lib/vip";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import KpiStrip from "@/components/customers/KpiStrip";
import BulkActionBar from "@/components/customers/BulkActionBar";
import BulkLineDialog from "@/components/customers/BulkLineDialog";
import { CustomerMessageDialog } from "@/components/CustomerMessageDialog";
import { cn } from "@/lib/utils";
import { todayInJst } from "@/lib/jst-date";

interface Customer {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  last_visit_date: string | null;
  visit_count: number;
  total_spent: number;
  line_user_id?: string | null;
  line_unfollowed_at?: string | null;
  opt_out_automation?: boolean | null;
  notes?: string | null;
  gender?: "female" | "male" | "other" | "unknown" | null;
  created_at?: string | null;
}

type SegKey = "active" | "at_risk" | "dormant" | "new";
type FilterKey = "all" | SegKey | "birthday" | "no_line" | "vip";
type SortKey = "recent" | "spent" | "visits" | "name";

const CUSTOMER_PAGE_SIZE = 200;

type DirectorySummary = Record<"all" | "active" | "at_risk" | "dormant" | "new" | "birthday" | "no_line" | "vip", number>;

type CustomerDirectoryRow = Customer & { total_count?: number | string | null };

type UntypedRpcResult = PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

const callDirectoryRpc = (name: string, args: Record<string, unknown>): UntypedRpcResult =>
  (supabase.rpc as unknown as (fn: string, params: Record<string, unknown>) => UntypedRpcResult)(name, args);

const segmentOf = (lastVisit: string | null): SegKey => {
  if (!lastVisit) return "new";
  const days = (Date.now() - new Date(lastVisit).getTime()) / 86400000;
  if (days <= 90) return "active";
  if (days <= 180) return "at_risk";
  return "dormant";
};

const segmentInfo: Record<SegKey, { label: string; color: string; dot: string }> = {
  active:  { label: "アクティブ",   color: "text-success",       dot: "bg-success" },
  at_risk: { label: "離脱予備軍",   color: "text-warning",       dot: "bg-warning" },
  dormant: { label: "休眠",         color: "text-destructive",   dot: "bg-destructive" },
  new:     { label: "新規",         color: "text-muted-foreground", dot: "bg-muted-foreground" },
};

const formatDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days === 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 30) return `${days}日前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年前`;
};

interface RowData {
  customers: Customer[];
  selected: Set<string>;
  toggle: (id: string) => void;
  onEdit: (c: Customer) => void;
  onQr: (c: Customer) => void;
  onMessage: (c: Customer) => void;
}

const CustomerRow = ({ index, style, customers, selected, toggle, onEdit, onQr, onMessage }: RowComponentProps<RowData>) => {
  const c = customers[index];
  if (!c) return null;
  const seg = segmentOf(c.last_visit_date);
  const sInfo = segmentInfo[seg];
  const tier = calculateVipTier(c.visit_count, c.total_spent);
  const t = tierInfo[tier];
  const bday = isBirthdayMonth(c.birthday);
  const isSelected = selected.has(c.id);

  return (
    <div style={style} className="px-1">
      <div
        className={cn(
          "h-full grid grid-cols-12 gap-3 items-center px-3 border-b border-border/60 transition-colors",
          isSelected ? "bg-gold/10" : "hover:bg-secondary/30",
          t.bg
        )}
      >
        {/* Checkbox */}
        <div className="col-span-1 flex items-center">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggle(c.id)}
            className="rounded-none data-[state=checked]:bg-gold data-[state=checked]:border-gold"
          />
        </div>

        {/* Name + Status dot + badges */}
        <div className="col-span-4 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", sInfo.dot)} title={sInfo.label} />
            <button
              onClick={() => onEdit(c)}
              className="font-serif text-sm hover:text-gold transition-colors truncate inline-flex items-center gap-1.5 group min-w-0"
            >
              <span className="truncate">{c.full_name}</span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 stroke-[1.5] shrink-0" />
            </button>
            {c.line_user_id ? (
              <span title="LINE連携済み" className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#06C755] text-white text-[8px] font-bold leading-none shrink-0">L</span>
            ) : (
              <button onClick={() => onQr(c)} title="LINE個別連携QR" className="inline-flex items-center justify-center w-4 h-4 border border-[#06C755]/40 text-[#06C755] hover:bg-[#06C755] hover:text-white transition-colors shrink-0">
                <QrCode className="w-2.5 h-2.5" />
              </button>
            )}
            {bday && <span title="今月誕生日" className="text-[11px] shrink-0">🎂</span>}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-3.5">
            {c.email && <span className="truncate max-w-[180px]">{c.email}</span>}
            {c.phone && <span>{c.phone}</span>}
            {!c.email && !c.phone && <span>連絡先未登録</span>}
          </div>
        </div>

        {/* Tier */}
        <div className="col-span-1">
          <span className={cn("text-[10px] font-serif-en tracking-wider", t.color)}>{t.en}</span>
        </div>

        {/* Last visit */}
        <div className="col-span-2 text-xs">
          <div className="font-serif-en">{formatDate(c.last_visit_date)}</div>
          <div className="text-[10px] text-muted-foreground">{c.visit_count}回来店</div>
        </div>

        {/* Spend */}
        <div className="col-span-2 text-right">
          <div className="font-serif-en text-sm tabular-nums">¥{c.total_spent.toLocaleString()}</div>
        </div>

        {/* Actions */}
        <div className="col-span-2 flex items-center justify-end gap-1.5">
          <button
            onClick={() => onMessage(c)}
            disabled={!c.line_user_id || !!c.line_unfollowed_at}
            title={
              c.line_unfollowed_at ? "LINE解除済み"
                : !c.line_user_id ? "LINE未連携"
                : c.opt_out_automation ? "自動配信停止中（手動連絡のみ）"
                : "LINE送信"
            }
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 border text-[10px] font-serif-en tracking-wider transition-colors",
              c.line_user_id && !c.line_unfollowed_at
                ? "border-[#06C755]/50 text-[#06C755] hover:bg-[#06C755] hover:text-white"
                : "border-border text-muted-foreground/40 cursor-not-allowed"
            )}
          >
            <MessageCircle className="w-3 h-3 stroke-[1.5]" />
            LINE
          </button>
          <Link
            to={`/customers/${c.id}/chart`}
            className="inline-flex items-center gap-1 px-2 py-1 border border-gold/40 text-gold hover:bg-gold hover:text-background transition-colors text-[10px] font-serif-en tracking-wider"
            title="電子カルテ"
          >
            <FileText className="w-3 h-3 stroke-[1.5]" />
            カルテ
          </Link>
        </div>
      </div>
    </div>
  );
};

const Customers = () => {
  const locationId = useCurrentLocationId();
  const tenantId = useTenantId();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [summary, setSummary] = useState<DirectorySummary>({ all: 0, active: 0, at_risk: 0, dormant: 0, new: 0, birthday: 0, no_line: 0, vip: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditableCustomer | null>(null);
  const [qrTarget, setQrTarget] = useState<{ id: string; name: string } | null>(null);
  const [lineAddUrl, setLineAddUrl] = useState<string | null>(null);
  const [bulkLineOpen, setBulkLineOpen] = useState(false);
  const [messageTarget, setMessageTarget] = useState<Customer | null>(null);
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [profileResult, locationResult] = await Promise.all([
        tenantId
          ? supabase.from("profiles").select("line_add_friend_url").eq("id", tenantId).maybeSingle()
          : Promise.resolve({ data: null }),
        locationId
          ? supabase
              .from("locations")
              .select("line_add_friend_url")
              .eq("id", locationId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      const profile = (profileResult.data || {}) as { line_add_friend_url?: string | null };
      const location = (locationResult.data || {}) as { line_add_friend_url?: string | null };
      setLineAddUrl(location.line_add_friend_url || profile.line_add_friend_url || null);
    })();
    return () => { active = false; };
  }, [tenantId, locationId]);

  const loadSummary = useCallback(async () => {
    if (!tenantId || !locationId) return;
    const { data, error } = await callDirectoryRpc("customer_directory_summary_v1", {
      _owner_id: tenantId,
      _location_id: locationId,
    });
    if (error) {
      console.warn("[customers:summary] fetch failed", { message: error.message, locationId });
      return;
    }
    const value = (data || {}) as Partial<DirectorySummary>;
    setSummary({
      all: Number(value.all || 0),
      active: Number(value.active || 0),
      at_risk: Number(value.at_risk || 0),
      dormant: Number(value.dormant || 0),
      new: Number(value.new || 0),
      birthday: Number(value.birthday || 0),
      no_line: Number(value.no_line || 0),
      vip: Number(value.vip || 0),
    });
  }, [tenantId, locationId]);

  const load = useCallback(async (offset = 0, append = false) => {
    if (!tenantId || !locationId) {
      setCustomers([]);
      setTotalCount(0);
      setLoading(false);
      setHasMore(false);
      return;
    }
    if (append) setLoadingMore(true); else setLoading(true);
    const { data, error } = await callDirectoryRpc("search_customer_directory_v1", {
      _owner_id: tenantId,
      _location_id: locationId,
      _search: search.trim(),
      _filter: filter,
      _sort: sort,
      _limit: CUSTOMER_PAGE_SIZE,
      _offset: offset,
    });

    if (error) {
      console.warn("[customers:list] fetch failed", {
        message: error.message,
        locationId,
        hasSearch: Boolean(search.trim()),
      });
      toast.error("顧客一覧の読み込みに失敗しました");
      if (!append) {
        setCustomers([]);
        setTotalCount(0);
      }
    } else {
      const rows = ((data || []) as CustomerDirectoryRow[]).map(({ total_count: _totalCount, ...row }) => row);
      const responseRows = (data || []) as CustomerDirectoryRow[];
      const nextTotal = responseRows.length > 0
        ? Number(responseRows[0].total_count || 0)
        : offset;
      setCustomers((current) => append ? [...current, ...rows] : rows);
      setTotalCount(nextTotal);
      setHasMore(offset + rows.length < nextTotal);
    }
    if (append) setLoadingMore(false); else setLoading(false);
  }, [tenantId, locationId, search, filter, sort]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load(0, false);
      void loadSummary();
      setSelected(new Set());
    }, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [load, loadSummary, search, filter, sort]);

  // Counts for KPI strip
  const counts = summary;

  const filtered = useMemo(() => {
    const list = [...customers].sort((a, b) => {
      if (recentlyAddedId) {
        if (a.id === recentlyAddedId && b.id !== recentlyAddedId) return -1;
        if (b.id === recentlyAddedId && a.id !== recentlyAddedId) return 1;
      }
      return 0;
    });
    return list;
  }, [customers, recentlyAddedId]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSel = () => setSelected(new Set());
  const selectAllVisible = () => setSelected(new Set(filtered.map((c) => c.id)));

  const selectedCustomers = useMemo(
    () => customers.filter((c) => selected.has(c.id) && c.line_user_id),
    [customers, selected]
  );
  const selectedAll = useMemo(
    () => customers.filter((c) => selected.has(c.id)),
    [customers, selected]
  );

  const handleCustomerAdded = useCallback((customer?: AddedCustomer) => {
    if (customer?.id) {
      const added = customer as Customer;
      setRecentlyAddedId(added.id);
      setCustomers((prev) => [added, ...prev.filter((c) => c.id !== added.id)]);
      setTotalCount((prev) => (typeof prev === "number" ? prev + (customers.some((c) => c.id === added.id) ? 0 : 1) : prev));
    }
    void load(0, false);
    void loadSummary();
  }, [customers, load, loadSummary]);

  const exportCsv = () => {
    if (selectedAll.length === 0) return;
    const rows = [["氏名", "メール", "電話", "最終来店", "来店回数", "累計売上"]];
    for (const c of selectedAll) {
      rows.push([
        c.full_name, c.email || "", c.phone || "",
        c.last_visit_date || "", String(c.visit_count), String(c.total_spent),
      ]);
    }
    const csv = "\uFEFF" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `customers_${todayInJst()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`${selectedAll.length}名分をエクスポートしました`);
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  const kpiItems = [
    { key: "all"      as FilterKey, label: "全顧客",       en: "Total",    count: counts.all },
    { key: "active"   as FilterKey, label: "アクティブ",   en: "Active",   count: counts.active,   tone: "default" as const },
    { key: "at_risk"  as FilterKey, label: "離脱予備軍",   en: "At Risk",  count: counts.at_risk,  tone: "warn"    as const },
    { key: "dormant"  as FilterKey, label: "休眠",         en: "Dormant",  count: counts.dormant,  tone: "danger"  as const },
    { key: "vip"      as FilterKey, label: "VIP",         en: "VIP",      count: counts.vip,       tone: "gold"    as const },
    { key: "birthday" as FilterKey, label: "今月誕生日",   en: "Birthday", count: counts.birthday,  tone: "gold"    as const },
    { key: "no_line"  as FilterKey, label: "LINE未連携",   en: "No LINE",  count: counts.no_line,   tone: "line"    as const },
  ];

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-8 gap-4">
        <PageHeader
          eyebrow="No.02 — Guests"
          title="顧客一覧"
          description={`${summary.all.toLocaleString()} 名の大切なお客様。今日やるべきことが、ここから始まります。`}
        />
        <Button onClick={() => setAddOpen(true)}
          className="rounded-none px-5 py-5 text-xs tracking-luxury bg-primary hover:bg-primary-glow shrink-0 mt-2">
          <Plus className="w-3.5 h-3.5 mr-2 stroke-[1.5]" /> お客様を追加
        </Button>
      </div>

      <AddCustomerDialog open={addOpen} onOpenChange={setAddOpen} onAdded={handleCustomerAdded} />
      <ErrorBoundary fallbackTitle="顧客情報の読み込みに失敗しました">
        <EditCustomerDialog
          customer={editTarget}
          open={!!editTarget}
          onOpenChange={(v) => { if (!v) setEditTarget(null); }}
          onSaved={load}
        />
      </ErrorBoundary>

      <PendingLineFriends onConverted={load} />

      {/* KPI Strip — クリックで即フィルタ */}
      <KpiStrip items={kpiItems} active={filter} onSelect={(k) => setFilter(k as FilterKey)} />

      {/* Toolbar: search + active chip + sort */}
      <div className="flex flex-col md:flex-row gap-3 mb-6 items-stretch md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="氏名・メール・電話で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-6 rounded-none border-x-0 border-t-0 focus-visible:ring-0 focus-visible:border-gold"
          />
        </div>

        {filter !== "all" && (
          <button
            onClick={() => setFilter("all")}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-gold/10 border border-gold/40 text-gold text-[11px] tracking-wider hover:bg-gold/20"
          >
            {kpiItems.find((k) => k.key === filter)?.label}
            <span className="opacity-60">×</span>
          </button>
        )}

        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full md:w-44 rounded-none border-x-0 border-t-0 focus:ring-0">
            <ArrowUpDown className="w-3 h-3 mr-1.5 opacity-50" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">最終来店が新しい順</SelectItem>
            <SelectItem value="spent">累計売上が高い順</SelectItem>
            <SelectItem value="visits">来店回数が多い順</SelectItem>
            <SelectItem value="name">氏名順</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-12 gap-3 px-3 py-3 border-y border-border text-[10px] font-serif text-muted-foreground tracking-wider uppercase">
        <div className="col-span-1">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={(v) => v ? selectAllVisible() : clearSel()}
            className="rounded-none data-[state=checked]:bg-gold data-[state=checked]:border-gold"
          />
        </div>
        <div className="col-span-4">お名前 / 連絡先</div>
        <div className="col-span-1">ランク</div>
        <div className="col-span-2">最終来店</div>
        <div className="col-span-2 text-right">累計売上</div>
        <div className="col-span-2 text-right">アクション</div>
      </div>

      {/* Virtualized List */}
      {loading ? (
        <div className="py-24 text-center text-xs text-muted-foreground">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center">
          <p className="eyebrow mb-3">— No Results —</p>
          <p className="text-sm text-muted-foreground">
            該当する顧客が見つかりません
            {filter !== "all" && (
              <button onClick={() => setFilter("all")} className="ml-2 text-gold underline">
                フィルタを解除
              </button>
            )}
          </p>
        </div>
      ) : (
        <>
          <List
            rowComponent={CustomerRow}
            rowCount={filtered.length}
            rowHeight={68}
            rowProps={{ customers: filtered, selected, toggle, onEdit: (c) => setEditTarget(c), onQr: (c) => setQrTarget({ id: c.id, name: c.full_name }), onMessage: (c) => setMessageTarget(c) }}
            style={{ height: "calc(100vh - 480px)", minHeight: 400 }}
            overscanCount={5}
          />
          <div className="py-3 text-center text-[11px] text-muted-foreground border-t border-border">
            {filtered.length.toLocaleString()} / {(totalCount ?? filtered.length).toLocaleString()} 名を表示
            {selected.size > 0 && (
              <> ・ <span className="text-gold">{selected.size} 名選択中</span></>
            )}
          </div>
          {hasMore && (
            <div className="flex justify-center border-t border-border py-4">
              <Button
                type="button"
                variant="outline"
                className="rounded-none"
                disabled={loadingMore}
                onClick={() => void load(customers.length, true)}
              >
                {loadingMore ? "読み込み中..." : `さらに${CUSTOMER_PAGE_SIZE}名を読み込む`}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Floating bulk action bar */}
      <BulkActionBar
        count={selected.size}
        total={filtered.length}
        onClear={clearSel}
        onSelectAll={selectAllVisible}
        onLineBroadcast={() => {
          if (selectedAll.length === 0) {
            toast.error("送信対象を選択してください");
            return;
          }
          setBulkLineOpen(true);
        }}
        onExportCsv={exportCsv}
      />

      <BulkLineDialog
        open={bulkLineOpen}
        onClose={() => setBulkLineOpen(false)}
        customers={selectedAll.map((c) => ({
          id: c.id,
          full_name: c.full_name,
          email: c.email,
          phone: c.phone,
          line_user_id: c.line_user_id,
          birthday: c.birthday,
          gender: c.gender,
          last_visit_date: c.last_visit_date,
          visit_count: c.visit_count,
          total_spent: c.total_spent,
        }))}
      />

      {qrTarget && (
        <LineLinkQRDialog
          open={!!qrTarget}
          onOpenChange={(v) => !v && setQrTarget(null)}
          customerId={qrTarget.id}
          customerName={qrTarget.name}
          lineAddFriendUrl={lineAddUrl}
        />
      )}

      {messageTarget && (
        <CustomerMessageDialog
          open={!!messageTarget}
          onClose={() => setMessageTarget(null)}
          customerId={messageTarget.id}
          customerName={messageTarget.full_name}
          customerPhone={messageTarget.phone}
          hasLine={!!messageTarget.line_user_id}
          optOutAutomation={!!messageTarget.opt_out_automation}
          lineUnfollowed={!!messageTarget.line_unfollowed_at}
        />
      )}
    </AppLayout>
  );
};

export default Customers;
