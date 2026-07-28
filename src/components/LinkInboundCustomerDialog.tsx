import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Search, UserPlus, Link2, Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";

interface CustomerHit {
  id: string;
  full_name: string;
  name_kana: string | null;
  phone: string | null;
  line_user_id: string | null;
  last_visit_date: string | null;
  visit_count: number | null;
}

type DirectoryRpcResult = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

const searchDirectory = (args: Record<string, unknown>): DirectoryRpcResult =>
  (supabase.rpc as unknown as (name: string, params: Record<string, unknown>) => DirectoryRpcResult)(
    "search_customer_directory_v1",
    args,
  );

interface Props {
  open: boolean;
  onClose: () => void;
  inboundId: string;
  lineUserId: string;
  displayName: string | null;
  onLinked: (customerId: string) => void;
}

export const LinkInboundCustomerDialog = ({
  open, onClose, inboundId, lineUserId, displayName, onLinked,
}: Props) => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [tab, setTab] = useState<"search" | "create">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<CustomerHit | null>(null);
  const [existingOwner, setExistingOwner] = useState<CustomerHit | null>(null);

  // 新規作成フォーム
  const [newName, setNewName] = useState(displayName || "");
  const [newKana, setNewKana] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("search");
    setQuery("");
    setResults([]);
    setOverwriteTarget(null);
    setExistingOwner(null);
    setNewName(displayName || "");
    setNewKana("");
    setNewPhone("");
    // 同じline_user_idが既に別顧客に紐付いていないか自動チェック
    if (user && tenantId) {
      supabase
        .from("customers")
        .select("id, full_name, name_kana, phone, line_user_id, last_visit_date, visit_count")
        .eq("owner_id", tenantId)
        .eq("line_user_id", lineUserId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setExistingOwner(data as CustomerHit);
        });
    }
  }, [open, user, tenantId, lineUserId, displayName]);

  const search = async () => {
    if (!user || !tenantId) return;
    const q = query.trim();
    if (q.length < 1) { setResults([]); return; }
    setSearching(true);
    if (!locationId) {
      setSearching(false);
      toast.error("店舗を選択してください");
      return;
    }
    const { data, error } = await searchDirectory({
      _owner_id: tenantId,
      _location_id: locationId,
      _search: q,
      _filter: "all",
      _sort: "recent",
      _limit: 20,
      _offset: 0,
    });
    setSearching(false);
    if (error) { toast.error("検索に失敗しました: " + error.message); return; }
    setResults(((data || []) as CustomerHit[]).map((row) => ({
      id: row.id,
      full_name: row.full_name,
      name_kana: row.name_kana,
      phone: row.phone,
      line_user_id: row.line_user_id,
      last_visit_date: row.last_visit_date,
      visit_count: row.visit_count,
    })));
  };

  const performLink = async (customer: CustomerHit, overwrite: boolean) => {
    if (!user || !tenantId) return;
    if (existingOwner && existingOwner.id !== customer.id) {
      toast.error("このLINEアカウントは別の顧客に連携済みです。先に店舗管理者へ確認してください。");
      return;
    }
    setLinkingId(customer.id);
    try {
      // line_user_id を顧客に保存（既に値がある場合は overwrite=true 必須）
      if (!customer.line_user_id || overwrite) {
        const { error: cErr } = await supabase
          .from("customers")
          .update({ line_user_id: lineUserId })
          .eq("owner_id", tenantId)
          .eq("id", customer.id);
        if (cErr) { toast.error("顧客のLINE ID更新に失敗: " + cErr.message); return; }
      }
      // inbound 側の customer_id を更新（同じ owner の他inboundも一括）
      const { error: iErr } = await supabase
        .from("line_inbound_messages")
        .update({ customer_id: customer.id })
        .eq("owner_id", tenantId)
        .eq("line_user_id", lineUserId)
        .is("customer_id", null);
      if (iErr) { toast.error("問い合わせの紐付けに失敗: " + iErr.message); return; }

      toast.success(`${customer.full_name} 様に紐付けました`);
      onLinked(customer.id);
      onClose();
    } finally {
      setLinkingId(null);
      setOverwriteTarget(null);
    }
  };

  const handlePick = (c: CustomerHit) => {
    if (c.line_user_id && c.line_user_id !== lineUserId) {
      // 既に別のLINE IDが紐付いている → 上書き確認
      setOverwriteTarget(c);
      return;
    }
    performLink(c, false);
  };

  const createNew = async () => {
    if (!user || !tenantId || !locationId) return;
    const name = newName.trim();
    if (name.length < 1) { toast.error("お名前を入力してください"); return; }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          owner_id: tenantId,
          location_id: locationId || null,
          full_name: name,
          name_kana: newKana.trim() || null,
          phone: newPhone.replace(/\D/g, "") || null,
          line_user_id: lineUserId,
        })
        .select("id, full_name")
        .single();
      if (error) { toast.error("顧客作成に失敗: " + error.message); return; }

      const { error: iErr } = await supabase
        .from("line_inbound_messages")
        .update({ customer_id: data.id })
        .eq("owner_id", tenantId)
        .eq("line_user_id", lineUserId)
        .is("customer_id", null);
      if (iErr) { toast.error("問い合わせの紐付けに失敗: " + iErr.message); return; }

      toast.success(`${data.full_name} 様を新規登録し紐付けました`);
      onLinked(data.id);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="rounded-none max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center gap-2">
              <Link2 className="w-4 h-4 text-gold" />
              お客様情報と紐付け
            </DialogTitle>
          </DialogHeader>

          {/* LINE情報 */}
          <div className="border border-border bg-secondary/20 px-4 py-3 text-xs space-y-1">
            <div><span className="text-muted-foreground">LINE表示名:</span> {displayName || "—"}</div>
            <div className="font-mono text-[10px] text-muted-foreground break-all">{lineUserId}</div>
          </div>

          {/* 既存紐付け警告 */}
          {existingOwner && (
            <div className="border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs">
              ⚠️ このLINEユーザーは既に <strong>{existingOwner.full_name}</strong> 様に紐付いています。
              <Button
                size="sm"
                variant="outline"
                className="rounded-none ml-2 mt-2"
                onClick={() => performLink(existingOwner, false)}
                disabled={linkingId !== null}
              >
                この顧客に問い合わせを紐付ける
              </Button>
            </div>
          )}

          {/* タブ */}
          <div className="flex gap-2 border-b border-border">
            {([
              { k: "search", l: "既存顧客と紐付け", icon: Search },
              { k: "create", l: "新規顧客として登録", icon: UserPlus },
            ] as const).map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`px-4 py-2.5 text-sm font-serif tracking-wider transition-all border-b-2 -mb-px flex items-center gap-1.5 ${
                  tab === t.k ? "border-gold text-gold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />{t.l}
              </button>
            ))}
          </div>

          {tab === "search" ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  placeholder="氏名 / カナ / 電話番号で検索"
                  className="rounded-none"
                />
                <Button onClick={search} disabled={searching} className="rounded-none">
                  {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                </Button>
              </div>

              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {results.length === 0 && !searching && query && (
                  <p className="text-xs text-muted-foreground text-center py-6">該当なし</p>
                )}
                {results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={linkingId !== null}
                    onClick={() => handlePick(c)}
                    className="w-full text-left px-3 py-2.5 border border-border hover:border-gold/50 transition-all disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-serif text-sm">
                        {c.full_name}
                        {c.name_kana && <span className="text-[10px] text-muted-foreground ml-2">{c.name_kana}</span>}
                      </div>
                      {c.line_user_id && (
                        <span className="text-[10px] text-amber-600 border border-amber-500/40 px-1.5">LINE紐付済</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-3 mt-1">
                      {c.phone && <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{c.phone}</span>}
                      <span>来店 {c.visit_count ?? 0}回</span>
                      {c.last_visit_date && <span>最終 {c.last_visit_date}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">お名前 *</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="rounded-none mt-1" />
              </div>
              <div>
                <Label className="text-xs">フリガナ</Label>
                <Input value={newKana} onChange={(e) => setNewKana(e.target.value)} className="rounded-none mt-1" placeholder="例：ヤマダ ハナコ" />
              </div>
              <div>
                <Label className="text-xs">電話番号</Label>
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="rounded-none mt-1" placeholder="例：09012345678" />
              </div>
              <p className="text-[10px] text-muted-foreground">
                LINEユーザーIDを自動的に紐付けて新規登録します。
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onClose} className="rounded-none">キャンセル</Button>
                <Button onClick={createNew} disabled={creating} className="rounded-none">
                  {creating ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <UserPlus className="w-3.5 h-3.5 mr-2" />}
                  新規登録して紐付け
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 上書き確認 */}
      <AlertDialog open={!!overwriteTarget} onOpenChange={(o) => !o && setOverwriteTarget(null)}>
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>LINEユーザーIDを上書きしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{overwriteTarget?.full_name}</strong> 様には既に別のLINEユーザーIDが紐付いています。
              新しいLINEユーザーIDで上書きすると、以前のIDからは送信できなくなります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => overwriteTarget && performLink(overwriteTarget, true)}
              className="rounded-none"
            >
              上書きして紐付け
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
