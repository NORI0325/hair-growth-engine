import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import AddCustomerDialog from "@/components/AddCustomerDialog";
import EditCustomerDialog, { type EditableCustomer } from "@/components/EditCustomerDialog";
import PendingLineFriends from "@/components/PendingLineFriends";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, Plus, Mail, Pencil } from "lucide-react";
import { toast } from "sonner";

import { calculateVipTier, tierInfo, isBirthdayMonth } from "@/lib/vip";
import { useCurrentLocationId } from "@/hooks/useLocations";

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
  notes?: string | null;
}

const segmentOf = (lastVisit: string | null): "active" | "at_risk" | "dormant" | "new" => {
  if (!lastVisit) return "new";
  const days = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 90) return "active";
  if (days <= 180) return "at_risk";
  return "dormant";
};

const segmentInfo: Record<string, { label: string; en: string; color: string }> = {
  active: { label: "アクティブ", en: "Active", color: "text-success" },
  at_risk: { label: "離脱予備軍", en: "At Risk", color: "text-warning" },
  dormant: { label: "休眠", en: "Dormant", color: "text-destructive" },
  new: { label: "新規", en: "New", color: "text-muted-foreground" },
};

const Customers = () => {
  const locationId = useCurrentLocationId();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditableCustomer | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const sendTestThankYou = async (c: Customer) => {
    if (!c.email) {
      toast.error("メールアドレスが登録されていません");
      return;
    }
    setSendingId(c.id);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("salon_name")
        .maybeSingle();
      const { data: tokenRow } = await supabase
        .from("booking_tokens")
        .select("token")
        .eq("customer_id", c.id)
        .maybeSingle();
      const origin = window.location.origin;
      const bookingLink = tokenRow ? `${origin}/book/${tokenRow.token}` : `${origin}`;

      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "thank-you",
          recipientEmail: c.email,
          idempotencyKey: `test-thankyou-${c.id}-${Date.now()}`,
          templateData: {
            customerName: c.full_name,
            salonName: profile?.salon_name || "サロン",
            bookingLink,
          },
        },
      });
      if (error) throw error;
      toast.success(`${c.email} にお礼メールを送信しました（数十秒で届きます）`);
    } catch (e: any) {
      toast.error("送信に失敗しました: " + (e?.message || "unknown"));
    } finally {
      setSendingId(null);
    }
  };

  const load = async () => {
    if (!locationId) { setCustomers([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("id, full_name, email, phone, birthday, last_visit_date, visit_count, total_spent, line_user_id, notes, opt_out_automation, opt_out_reason")
      .eq("location_id", locationId)
      .order("last_visit_date", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (!error && data) setCustomers(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [locationId]);

  const filtered = useMemo(() => {
    return customers.filter(c => {
      const segment = segmentOf(c.last_visit_date);
      if (segmentFilter !== "all" && segment !== segmentFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return c.full_name.toLowerCase().includes(s) ||
               (c.email?.toLowerCase().includes(s) ?? false) ||
               (c.phone?.includes(s) ?? false);
      }
      return true;
    });
  }, [customers, search, segmentFilter]);

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-10 gap-4">
        <PageHeader
          eyebrow="No.02 — Guests"
          title="顧客一覧"
          description={`${customers.length} 名の大切なお客様が登録されています`}
        />
        <Button onClick={() => setAddOpen(true)}
          className="rounded-none px-5 py-5 text-xs tracking-luxury bg-primary hover:bg-primary-glow shrink-0 mt-2">
          <Plus className="w-3.5 h-3.5 mr-2 stroke-[1.5]" /> お客様を追加 <span className="ml-2 opacity-60 text-[10px]">ADD</span>
        </Button>
      </div>

      <AddCustomerDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
      <ErrorBoundary fallbackTitle="顧客情報の読み込みに失敗しました">
        <EditCustomerDialog
          customer={editTarget}
          open={!!editTarget}
          onOpenChange={(v) => { if (!v) setEditTarget(null); }}
          onSaved={load}
        />
      </ErrorBoundary>

      <PendingLineFriends onConverted={load} />

      <div className="flex flex-col md:flex-row gap-4 mb-10">
        <div className="relative flex-1">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="氏名・メール・電話で検索" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-6 rounded-none border-x-0 border-t-0 focus-visible:ring-0 focus-visible:border-gold" />
        </div>
        <Select value={segmentFilter} onValueChange={setSegmentFilter}>
          <SelectTrigger className="w-full md:w-56 rounded-none border-x-0 border-t-0 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="active">アクティブ</SelectItem>
            <SelectItem value="at_risk">離脱予備軍</SelectItem>
            <SelectItem value="dormant">休眠</SelectItem>
            <SelectItem value="new">新規</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="py-24 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-gold" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center">
          <p className="eyebrow mb-3">— No Results —</p>
          <p className="text-sm text-muted-foreground">該当する顧客が見つかりません</p>
        </div>
      ) : (
        <div className="border-t border-border">
          <div className="grid grid-cols-12 gap-4 py-4 border-b border-border text-[11px] font-serif text-muted-foreground">
            <div className="col-span-3">お名前</div>
            <div className="col-span-3">連絡先</div>
            <div className="col-span-2">最終来店</div>
            <div className="col-span-1 text-right">回数</div>
            <div className="col-span-1 text-right">ランク</div>
            <div className="col-span-1 text-right">状態</div>
            <div className="col-span-1 text-right">テスト</div>
          </div>
          {filtered.slice(0, 200).map(c => {
            const seg = segmentOf(c.last_visit_date);
            const info = segmentInfo[seg];
            const tier = calculateVipTier(c.visit_count, c.total_spent);
            const t = tierInfo[tier];
            const birthdayThisMonth = isBirthdayMonth(c.birthday);
            return (
              <div key={c.id} className={`grid grid-cols-12 gap-4 py-5 border-b border-border/60 hover:bg-secondary/30 transition-colors items-center ${t.bg}`}>
                <div className="col-span-3">
                  <div className="font-serif text-sm flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditTarget(c)}
                      className="hover:text-gold transition-colors text-left inline-flex items-center gap-1.5 group"
                      title="編集"
                    >
                      {c.full_name}
                      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 stroke-[1.5]" />
                    </button>
                    {c.line_user_id && (
                      <span title="LINE連携済み" className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#06C755] text-white text-[8px] font-bold leading-none">L</span>
                    )}
                    {birthdayThisMonth && <span title="今月誕生日" className="text-[10px] text-gold">🎂</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">¥{c.total_spent.toLocaleString()}</div>
                </div>
                <div className="col-span-3 text-xs text-muted-foreground">
                  <div className="truncate">{c.email || "—"}</div>
                  <div>{c.phone || "—"}</div>
                </div>
                <div className="col-span-2 text-xs font-serif-en">{c.last_visit_date || "—"}</div>
                <div className="col-span-1 text-right font-serif">{c.visit_count}</div>
                <div className="col-span-1 text-right">
                  <span className={`text-[11px] font-serif ${t.color}`}>{t.label}</span>
                </div>
                <div className="col-span-1 text-right">
                  <span className={`inline-flex items-center gap-2 text-[11px] font-serif ${info.color}`}>
                    <span className="w-1 h-1 rounded-full bg-current" />
                    {info.label}
                  </span>
                </div>
                <div className="col-span-1 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!c.email || sendingId === c.id}
                    onClick={() => sendTestThankYou(c)}
                    className="h-7 px-2 text-[10px] font-serif tracking-wider hover:text-gold rounded-none"
                    title={c.email ? "お礼メールをテスト送信" : "メールアドレスが未登録"}
                  >
                    {sendingId === c.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <><Mail className="w-3 h-3 mr-1" />送信</>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
          {filtered.length > 200 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              上位200件を表示しています（全{filtered.length}件）
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
};

export default Customers;
