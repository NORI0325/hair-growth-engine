import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, ImagePlus, X, Plug, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import ChannelMappingDialog from "@/components/ChannelMappingDialog";

interface MenuItem {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: number;
  sort_order: number;
  active: boolean;
  image_url: string | null;
  description: string | null;
}

type ChannelMenuOption = {
  id?: string;
  external_menu_id: string;
  setmenu_id?: string | null;
  menu_id?: string | null;
  menu_category_cd?: string | null;
  net_coupon_id?: string | null;
  source_type?: string | null;
  menu_name: string;
  rsv_term?: number | null;
  price?: number | null;
  active?: boolean | null;
  fetched_at?: string | null;
};

type MenuSyncStatus = {
  label: "同期可能" | "setmenu未登録" | "所要時間未登録" | "マッピング無効" | "予約フォーム非表示" | "単品メニュー（同期未検証）";
  className: string;
};

const hasPositivePrice = (price: unknown): price is number =>
  typeof price === "number" && Number.isFinite(price) && price > 0;

const MenuItems = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingMenus, setRefreshingMenus] = useState(false);
  const [draft, setDraft] = useState({ name: "", duration_minutes: 60, buffer_minutes: 15, price: 0 });
  const [mappingMenu, setMappingMenu] = useState<MenuItem | null>(null);
  const [salonboardSyncOn, setSalonboardSyncOn] = useState(false);
  const [syncStatusByMenuId, setSyncStatusByMenuId] = useState<Record<string, { label: string; className: string }>>({});
  const [channelCandidates, setChannelCandidates] = useState<ChannelMenuOption[]>([]);

  const load = async () => {
    if (!user || !tenantId || !locationId) {
      setItems([]);
      setSalonboardSyncOn(false);
      setSyncStatusByMenuId({});
      setChannelCandidates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("menu_items")
      .select("*")
      .eq("owner_id", tenantId)
      .eq("location_id", locationId)
      .order("sort_order", { ascending: true });
    const menuItems = (data || []) as MenuItem[];
    setItems(menuItems);

    const { data: candidates, error: candidateError } = await supabase
      .from("channel_menu_options" as any)
      .select("id, external_menu_id, setmenu_id, menu_id, menu_category_cd, net_coupon_id, source_type, menu_name, rsv_term, price, active, fetched_at")
      .eq("owner_id", tenantId)
      .eq("location_id", locationId)
      .eq("channel", "salonboard")
      .in("source_type", ["single_menu", "coupon", "category"])
      .order("source_type", { ascending: true })
      .order("menu_name", { ascending: true });
    if (candidateError) {
      console.error("failed to load salonboard menu candidates", candidateError);
      setChannelCandidates([]);
    } else {
      setChannelCandidates((candidates || []) as ChannelMenuOption[]);
    }

    const { data: ci } = await supabase
      .from("channel_integrations" as any)
      .select("enabled, sync_enabled, connection_status")
      .eq("owner_id", tenantId)
      .eq("location_id", locationId)
      .eq("channel", "salonboard")
      .maybeSingle();
    const ciRow = ci as any;
    const isSalonboardOn = Boolean(ciRow?.enabled && ciRow?.sync_enabled && ciRow?.connection_status === "live");
    setSalonboardSyncOn(isSalonboardOn);

    if (isSalonboardOn && menuItems.length > 0) {
      const { data: mappings } = await supabase
        .from("menu_channel_mappings" as any)
        .select("menu_id, enabled, external_id, external_setmenu_id, rsv_term")
        .eq("owner_id", tenantId)
        .eq("location_id", locationId)
        .eq("channel", "salonboard")
        .in("menu_id", menuItems.map((item) => item.id));
      const mappingByMenuId = new Map((mappings || []).map((m: any) => [String(m.menu_id), m]));
      const nextStatus: Record<string, { label: string; className: string }> = {};
      const resolveSetmenuId = (m: any) => {
        if (m?.external_setmenu_id) return String(m.external_setmenu_id);
        const externalId = String(m?.external_id || "");
        return /^SN/i.test(externalId) ? externalId : "";
      };
      for (const item of menuItems) {
        const m: any = mappingByMenuId.get(item.id);
        if (!item.active) {
          nextStatus[item.id] = { label: "予約フォーム非表示", className: "border-muted text-muted-foreground" };
        } else if (m?.enabled === false) {
          nextStatus[item.id] = { label: "マッピング無効", className: "border-destructive/50 text-destructive" };
        } else if (m && m.external_id && !resolveSetmenuId(m)) {
          nextStatus[item.id] = { label: "単品メニュー（同期未検証）", className: "border-amber-500 text-amber-700" };
        } else if (!m || !resolveSetmenuId(m)) {
          nextStatus[item.id] = { label: "setmenu未登録", className: "border-destructive/50 text-destructive" };
        } else if (m.rsv_term == null) {
          nextStatus[item.id] = { label: "所要時間未登録", className: "border-amber-500 text-amber-600" };
        } else {
          nextStatus[item.id] = { label: "同期可能", className: "border-emerald-500 text-emerald-700" };
        }
      }
      setSyncStatusByMenuId(nextStatus);
    } else {
      setSyncStatusByMenuId({});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, tenantId, locationId]);

  const add = async () => {
    if (!user || !tenantId || !locationId) { toast.error("店舗が未選択のためメニューを保存できません"); return; }
    if (salonboardSyncOn) { toast.error("サロンボード連携中の店舗では、先にサロンボードでメニューを作成してください"); return; }
    if (!draft.name.trim()) { toast.error("メニュー名を入力してください"); return; }
    setSaving(true);
    const max = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
    const { error } = await supabase.from("menu_items").insert({
      owner_id: tenantId,
      location_id: locationId,
      name: draft.name.trim().slice(0, 80),
      duration_minutes: draft.duration_minutes,
      buffer_minutes: draft.buffer_minutes,
      price: draft.price,
      sort_order: max + 1,
    });
    setSaving(false);
    if (error) { toast.error("追加に失敗しました: " + error.message); return; }
    setDraft({ name: "", duration_minutes: 60, buffer_minutes: 15, price: 0 });
    toast.success("メニューを追加しました");
    load();
  };

  const importSalonboardMenus = async (fetchedMenus: ChannelMenuOption[]) => {
    if (!tenantId || !locationId) return { setmenuCount: 0, singleMenuCount: 0, updatedCount: 0 };
    const mirrorMenus = fetchedMenus.filter((menu) =>
      menu.source_type === "setmenu" && !!menu.setmenu_id && menu.rsv_term != null
    );
    if (mirrorMenus.length === 0) return { setmenuCount: 0, singleMenuCount: 0, updatedCount: 0 };

    const { data: mappings } = await supabase
      .from("menu_channel_mappings" as any)
      .select("menu_id, external_id, external_setmenu_id")
      .eq("owner_id", tenantId)
      .eq("location_id", locationId)
      .eq("channel", "salonboard");

    const mappedMenuIdByExternalId = new Map<string, string>();
    for (const mapping of mappings || []) {
      const m = mapping as any;
      if (m.external_id) mappedMenuIdByExternalId.set(String(m.external_id), String(m.menu_id));
      if (m.external_setmenu_id) mappedMenuIdByExternalId.set(String(m.external_setmenu_id), String(m.menu_id));
    }

    const importItems = mirrorMenus.map((menu) => {
      const isSetmenu = menu.source_type === "setmenu";
      const externalKey = String(isSetmenu ? menu.setmenu_id : (menu.menu_id || menu.external_menu_id));
      const mappedMenuId = mappedMenuIdByExternalId.get(externalKey) ?? null;
      return {
        external_menu_id: menu.external_menu_id || externalKey,
        setmenu_id: isSetmenu ? menu.setmenu_id : null,
        menu_id: isSetmenu ? (menu.menu_id ?? null) : externalKey,
        menu_category_cd: menu.menu_category_cd ?? null,
        net_coupon_id: null,
        source_type: menu.source_type,
        menu_name: menu.menu_name,
        rsv_term: menu.rsv_term ?? null,
        price: menu.price ?? null,
        active: menu.active !== false,
        action: mappedMenuId ? "link" as const : "create" as const,
        target_menu_id: mappedMenuId,
      };
    });
    if (importItems.length === 0) return { setmenuCount: 0, singleMenuCount: 0, updatedCount: 0 };

    for (const item of importItems.filter((menu) => menu.action === "link")) {
      const menuPatch: { name: string; duration_minutes: number; active: boolean; price?: number } = {
        name: item.menu_name,
        duration_minutes: item.rsv_term && item.rsv_term > 0 ? item.rsv_term : 60,
        active: item.active,
      };
      if (hasPositivePrice(item.price)) menuPatch.price = item.price as number;

      const { error: itemUpdateError } = await supabase
        .from("menu_items")
        .update(menuPatch)
        .eq("id", item.target_menu_id)
        .eq("owner_id", tenantId)
        .eq("location_id", locationId);
      if (itemUpdateError) throw itemUpdateError;
    }

    const importRes = await supabase.functions.invoke("salonboard-bulk-import-menus", {
      body: { owner_id: tenantId, location_id: locationId, items: importItems },
    });
    if (importRes.error || (importRes.data as any)?.success === false) {
      throw new Error(importRes.error?.message || (importRes.data as any)?.message || "salonboard-bulk-import-menus failed");
    }
    const okExternalIds = new Set(((importRes.data as any)?.results || [])
      .filter((r: any) => r.status === "ok")
      .map((r: any) => String(r.external_menu_id)));
    const okItems = importItems.filter((item) => okExternalIds.has(String(item.external_menu_id)));
    return {
      setmenuCount: okItems.filter((item) => item.source_type === "setmenu").length,
      singleMenuCount: okItems.filter((item) => item.source_type === "single_menu").length,
      updatedCount: okItems.filter((item) => item.action === "link").length,
    };
  };

  const refreshSalonboardMenus = async () => {
    if (!tenantId || !locationId) { toast.error("店舗が未選択のためメニューを更新できません"); return; }
    setRefreshingMenus(true);
    const { data, error } = await supabase.functions.invoke("salonboard-fetch-menus", {
      body: { owner_id: tenantId, location_id: locationId },
    });
    setRefreshingMenus(false);
    if (error || (data as any)?.success === false) {
      toast.error("サロンボードメニューの更新に失敗しました");
      return;
    }
    let imported = { setmenuCount: 0, singleMenuCount: 0, updatedCount: 0 };
    const fetchedMenus = (((data as any)?.menus || []) as ChannelMenuOption[]);
    setChannelCandidates(fetchedMenus.filter((menu) =>
      menu.source_type === "single_menu" || menu.source_type === "coupon" || menu.source_type === "category"
    ));
    try {
      imported = await importSalonboardMenus(fetchedMenus);
    } catch (importError) {
      toast.error("サロンボードメニューの取り込みに失敗しました");
      console.error("salonboard menu import failed", importError);
      load();
      return;
    }
    if (imported.setmenuCount > 0 || imported.singleMenuCount > 0 || imported.updatedCount > 0) {
      toast.success(`同期可能メニュー${imported.setmenuCount}件、単品メニュー${imported.singleMenuCount}件を更新しました`);
    }
    toast.success(`サロンボードメニューを更新しました（${(data as any)?.count ?? 0}件）`);
    load();
  };

  const update = async (id: string, patch: Partial<MenuItem>) => {
    if (!tenantId || !locationId) { toast.error("店舗が未選択のためメニューを保存できません"); return; }
    setItems(items.map(i => i.id === id ? { ...i, ...patch } : i));
    const { error } = await supabase.from("menu_items")
      .update(patch)
      .eq("id", id)
      .eq("owner_id", tenantId)
      .eq("location_id", locationId);
    if (error) { toast.error("更新に失敗: " + error.message); load(); }
  };

  const remove = async (id: string) => {
    if (!tenantId || !locationId) { toast.error("店舗が未選択のためメニューを保存できません"); return; }
    if (!confirm("このメニューを削除しますか？")) return;
    const { error } = await supabase.from("menu_items")
      .delete()
      .eq("id", id)
      .eq("owner_id", tenantId)
      .eq("location_id", locationId);
    if (error) { toast.error("削除に失敗: " + error.message); return; }
    toast.success("削除しました");
    load();
  };

  const uploadImage = async (id: string, file: File) => {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("画像は5MB以下にしてください"); return; }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${user.id}/${id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("menu-images").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type,
    });
    if (upErr) { toast.error("画像アップロード失敗: " + upErr.message); return; }
    const { data: pub } = supabase.storage.from("menu-images").getPublicUrl(path);
    update(id, { image_url: pub.publicUrl });
    toast.success("画像をアップロードしました");
  };

  const removeImage = async (id: string, imageUrl: string | null) => {
    if (!user || !imageUrl) return;
    // URLからパス部分を抽出
    const marker = "/menu-images/";
    const idx = imageUrl.indexOf(marker);
    if (idx >= 0) {
      const path = imageUrl.slice(idx + marker.length);
      await supabase.storage.from("menu-images").remove([path]);
    }
    update(id, { image_url: null });
    toast.success("画像を削除しました");
  };

  const singleMenuCandidates = channelCandidates.filter((candidate) => candidate.source_type === "single_menu");
  const couponCandidates = channelCandidates.filter((candidate) => candidate.source_type === "coupon");
  const categoryCandidates = channelCandidates.filter((candidate) => candidate.source_type === "category");

  const formatCandidatePrice = (price: number | null | undefined) =>
    typeof price === "number" && Number.isFinite(price)
      ? `¥${price.toLocaleString()}`
      : "価格未取得";

  const formatCandidateDuration = (duration: number | null | undefined) =>
    typeof duration === "number" && Number.isFinite(duration)
      ? `${duration}分`
      : "所要時間未取得";

  const formatFetchedAt = (fetchedAt: string | null | undefined) => {
    if (!fetchedAt) return "取得日時未取得";
    const timestamp = Date.parse(fetchedAt);
    return Number.isNaN(timestamp) ? fetchedAt : new Date(timestamp).toLocaleString("ja-JP");
  };

  const candidateDisplayId = (candidate: ChannelMenuOption) => {
    if (candidate.source_type === "coupon") return candidate.net_coupon_id || candidate.external_menu_id || "-";
    if (candidate.source_type === "single_menu") return candidate.menu_id || candidate.external_menu_id || "-";
    if (candidate.source_type === "category") return candidate.menu_category_cd || candidate.external_menu_id || "-";
    return candidate.external_menu_id || "-";
  };

  const renderCandidateSection = ({
    title,
    description,
    badge,
    badgeClassName,
    candidates,
    emptyMessage,
  }: {
    title: string;
    description: string;
    badge: string;
    badgeClassName: string;
    candidates: ChannelMenuOption[];
    emptyMessage: string;
  }) => (
    <section className="border border-border">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-serif text-lg">{title}</h2>
          <span className={`inline-flex items-center border px-2 py-1 text-[10px] ${badgeClassName}`}>
            {badge}
          </span>
          <span className="text-[10px] text-muted-foreground">{candidates.length}件</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
      {candidates.length === 0 ? (
        <div className="px-4 py-5 text-xs text-muted-foreground leading-relaxed">
          {emptyMessage}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {candidates.map((candidate, index) => (
            <div
              key={candidate.id || `${candidate.source_type}-${candidate.external_menu_id}-${index}`}
              className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-12 md:items-center"
            >
              <div className="md:col-span-4">
                <p className="text-sm font-medium">{candidate.menu_name || "名称未取得"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  ID: {candidateDisplayId(candidate)}
                </p>
              </div>
              <div className="text-xs md:col-span-2">
                <p className="text-muted-foreground">価格</p>
                <p>{formatCandidatePrice(candidate.price)}</p>
              </div>
              <div className="text-xs md:col-span-2">
                <p className="text-muted-foreground">所要時間</p>
                <p>{formatCandidateDuration(candidate.rsv_term)}</p>
              </div>
              <div className="text-xs md:col-span-2">
                <p className="text-muted-foreground">種別</p>
                <p>source_type='{candidate.source_type || "-"}'</p>
              </div>
              <div className="text-xs md:col-span-2">
                <p className="text-muted-foreground">取得日時</p>
                <p>{formatFetchedAt(candidate.fetched_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <AppLayout>
      <PageHeader
        title="メニュー管理"
        eyebrow="— Menu Items —"
        description="お客様が予約時に選べるメニューを管理します。所要時間と料金を設定すると、予約画面で合計が自動計算されます。"
      />

      {/* 追加フォーム */}
      <div className="border border-border p-6 mb-8">
        <p className="eyebrow mb-4">— Add Menu —</p>
        {salonboardSyncOn && (
          <div className="mb-4 border border-amber-500/40 bg-amber-50 px-4 py-3 text-xs text-amber-900 leading-relaxed">
            サロンボード連携中の店舗では、新メニューは先にサロンボードで作成し、「最新メニューに更新」から取り込んでください。
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2">
            <Label className="font-serif text-xs mb-2 block">メニュー名</Label>
            <Input value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}
              placeholder="例：カット" className="rounded-none" />
          </div>
          <div>
            <Label className="font-serif text-xs mb-2 block">所要時間（分）</Label>
            <Input type="number" min={5} step={5} value={draft.duration_minutes}
              onChange={e => setDraft({...draft, duration_minutes: Number(e.target.value)})}
              className="rounded-none" />
          </div>
          <div>
            <Label className="font-serif text-xs mb-2 block">バッファ（分）</Label>
            <Input type="number" min={0} step={5} value={draft.buffer_minutes}
              onChange={e => setDraft({...draft, buffer_minutes: Number(e.target.value)})}
              className="rounded-none" />
          </div>
          <div>
            <Label className="font-serif text-xs mb-2 block">料金（円）</Label>
            <Input type="number" min={0} step={100} value={draft.price}
              onChange={e => setDraft({...draft, price: Number(e.target.value)})}
              className="rounded-none" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={add} disabled={saving || salonboardSyncOn} className="rounded-none tracking-luxury">
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-2" />}
            追加 <span className="ml-2 opacity-60 text-[10px]">ADD</span>
          </Button>
          {salonboardSyncOn && (
            <Button onClick={refreshSalonboardMenus} disabled={refreshingMenus} variant="outline" className="rounded-none tracking-luxury">
              {refreshingMenus ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
              最新メニューに更新
            </Button>
          )}
        </div>
      </div>

      {/* 一覧 */}
      <section className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-serif text-lg">同期可能メニュー</h2>
          <span className="inline-flex items-center border border-emerald-500 px-2 py-1 text-[10px] text-emerald-700">
            予約フォーム表示対象
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          source_type='setmenu' かつ setmenu_id / external_setmenu_id と rsv_term があるメニューです。
        </p>
      </section>
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="eyebrow mb-2">— No Menus —</p>
          <p className="text-sm">最初のメニューを追加しましょう</p>
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {items.map(item => (
            <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-secondary/30 transition-colors">
              <div className="md:col-span-1">
                {item.image_url ? (
                  <div className="relative group w-14 h-14 border border-border overflow-hidden">
                    <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(item.id, item.image_url)}
                      className="absolute inset-0 bg-foreground/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                      title="画像を削除"
                    >
                      <X className="w-4 h-4 text-background" />
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer w-14 h-14 border border-dashed border-border flex items-center justify-center hover:border-gold hover:bg-secondary/30 transition-all">
                    <ImagePlus className="w-4 h-4 text-muted-foreground" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadImage(item.id, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="md:col-span-3">
                <Input value={item.name} onChange={e => update(item.id, { name: e.target.value })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
              </div>
              <div className="md:col-span-2">
                <Input type="number" value={item.duration_minutes}
                  onChange={e => update(item.id, { duration_minutes: Number(e.target.value) })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                <span className="text-[10px] text-muted-foreground ml-1">分</span>
              </div>
              <div className="md:col-span-2">
                <Input type="number" value={item.buffer_minutes}
                  onChange={e => update(item.id, { buffer_minutes: Number(e.target.value) })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                <span className="text-[10px] text-muted-foreground ml-1">バッファ</span>
              </div>
              <div className="md:col-span-2">
                <Input type="number" value={item.price}
                  onChange={e => update(item.id, { price: Number(e.target.value) })}
                  className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
                <span className="text-[10px] text-muted-foreground ml-1">円</span>
              </div>
              <div className="md:col-span-1 flex items-center gap-2">
                <Switch checked={item.active} onCheckedChange={(v) => update(item.id, { active: v })} />
              </div>
              <div className="md:col-span-1 flex justify-end gap-1">
                {salonboardSyncOn && syncStatusByMenuId[item.id] && (
                  <span className={`inline-flex items-center whitespace-nowrap border px-2 py-1 text-[10px] ${syncStatusByMenuId[item.id].className}`}>
                    {syncStatusByMenuId[item.id].label}
                  </span>
                )}
                <Button size="icon" variant="ghost" onClick={() => setMappingMenu(item)} title="媒体マッピング">
                  <Plug className="w-4 h-4 text-muted-foreground hover:text-gold" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(item.id)}>
                  <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="mt-8 space-y-6">
          {renderCandidateSection({
            title: "単品メニュー（同期未検証）",
            description: "サロンボード上の単品メニューです。現在は予約同期対象外です。",
            badge: "同期未検証",
            badgeClassName: "border-amber-500 text-amber-700",
            candidates: singleMenuCandidates,
            emptyMessage: "channel_menu_options に source_type='single_menu' の取得済み候補がないため、単品メニューはまだ表示されていません。fetchMenus が単品メニューを返して保存できると、この欄に表示されます。",
          })}
          {renderCandidateSection({
            title: "クーポン（同期未検証）",
            description: "サロンボード上のクーポンです。現在は予約同期対象外です。",
            badge: "同期未検証",
            badgeClassName: "border-amber-500 text-amber-700",
            candidates: couponCandidates,
            emptyMessage: "channel_menu_options に source_type='coupon' の取得済み候補がありません。CP00000008809041 も、net_coupon_id を持つ coupon 行が保存されてから表示されます。",
          })}
          {renderCandidateSection({
            title: "カテゴリ（同期対象外）",
            description: "サロンボード上のカテゴリです。カテゴリ単体では予約同期に使いません。",
            badge: "同期対象外",
            badgeClassName: "border-muted text-muted-foreground",
            candidates: categoryCandidates,
            emptyMessage: "channel_menu_options に source_type='category' の取得済み候補がありません。",
          })}
        </div>
      )}

      <div className="mt-8 p-6 border border-gold/30 bg-secondary/20">
        <p className="eyebrow mb-3 text-gold">— Tips —</p>
        <ul className="text-xs text-muted-foreground space-y-2 leading-relaxed">
          <li>• <strong>メニュー画像</strong>：仕上がり写真をアップロードすると、お客様の予約画面で視覚的に魅力的に表示されます（5MB以下推奨）。</li>
          <li>• <strong>バッファ時間</strong>：施術後の片付け・カウンセリングなど。次のお客様までの余裕時間として確保されます。</li>
          <li>• <strong>無効化</strong>：スイッチをオフにすると、お客様の予約画面に表示されなくなります（既存データは残ります）。</li>
          <li>• <strong>並び順</strong>：上から順に予約画面に表示されます。</li>
        </ul>
      </div>
      <ChannelMappingDialog
        open={!!mappingMenu}
        onOpenChange={(v) => !v && setMappingMenu(null)}
        kind="menu"
        targetId={mappingMenu?.id ?? null}
        targetName={mappingMenu?.name}
      />
    </AppLayout>
  );
};

export default MenuItems;
