import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { Loader2, Download, Upload } from "lucide-react";

type StaffOpt = {
  id: string; external_staff_id: string; display_name: string;
  is_no_designation: boolean; active: boolean; fetched_at: string;
};
type MenuOpt = {
  id: string; external_menu_id: string; setmenu_id: string | null; menu_id: string | null;
  menu_category_cd: string | null; net_coupon_id?: string | null; source_type?: string | null;
  menu_name: string; rsv_term: number | null; price: number | null;
  active: boolean; fetched_at: string;
};
type ExistingStaff = { id: string; name: string };
type ExistingMenu = { id: string; name: string };

export default function SalonboardAutoMapping() {
  const { user } = useAuth();
  const { locationId } = useParams();
  const currentLocationId = useCurrentLocationId();
  const loc = locationId && locationId !== "default" ? locationId : currentLocationId;

  const [staffOpts, setStaffOpts] = useState<StaffOpt[]>([]);
  const [menuOpts, setMenuOpts] = useState<MenuOpt[]>([]);
  const [existingStaff, setExistingStaff] = useState<ExistingStaff[]>([]);
  const [existingMenus, setExistingMenus] = useState<ExistingMenu[]>([]);
  const [staffActions, setStaffActions] = useState<Record<string, { action: string; target?: string }>>({});
  const [menuActions, setMenuActions] = useState<Record<string, { action: string; target?: string }>>({});
  const [fetching, setFetching] = useState<"" | "staff" | "menus">("");
  const [importing, setImporting] = useState(false);
  const [mappedStaffExt, setMappedStaffExt] = useState<Set<string>>(new Set());
  const [mappedMenuExt, setMappedMenuExt] = useState<Set<string>>(new Set());
  const [menuRsvTerm, setMenuRsvTerm] = useState<Record<string, number | "">>({});
  const [showCoupon, setShowCoupon] = useState(false);
  const [showCategory, setShowCategory] = useState(false);

  // クーポンの注意ラベル検出
  const COUPON_WARN_PATTERNS = [
    "平日限定", "時間限定", "学割", "こちらからの予約不可",
    "スタイリスト指定", "新規限定", "再来限定", "土日不可", "ネット予約不可",
  ];
  const detectCouponWarnings = (label: string): string[] =>
    COUPON_WARN_PATTERNS.filter((p) => label.includes(p));

  // source_type の判定（古いデータは setmenu 扱い）
  const getSrcType = (m: MenuOpt): "setmenu" | "coupon" | "category" => {
    if (m.source_type === "coupon" || m.source_type === "category" || m.source_type === "setmenu") return m.source_type;
    if (m.net_coupon_id) return "coupon";
    if (m.menu_category_cd && !m.setmenu_id) return "category";
    return "setmenu";
  };

  const load = async () => {
    if (!user) return;
    if (!loc) {
      setStaffOpts([]); setMenuOpts([]); setExistingStaff([]); setExistingMenus([]);
      setMappedStaffExt(new Set()); setMappedMenuExt(new Set());
      return;
    }
    let sQ = supabase.from("channel_staff_options" as any).select("*")
      .eq("owner_id", user.id).eq("channel", "salonboard").order("display_name");
    sQ = loc ? sQ.eq("location_id", loc) : sQ.is("location_id", null);
    const { data: s } = await sQ;
    setStaffOpts((s || []) as any);

    let mQ = supabase.from("channel_menu_options" as any).select("*")
      .eq("owner_id", user.id).eq("channel", "salonboard").order("menu_name");
    mQ = loc ? mQ.eq("location_id", loc) : mQ.is("location_id", null);
    const { data: m } = await mQ;
    setMenuOpts((m || []) as any);

    const { data: es } = await supabase.from("staff").select("id,name").eq("owner_id", user.id).eq("location_id", loc).eq("active", true).order("name");
    setExistingStaff((es || []) as any);
    const { data: em } = await supabase.from("menu_items").select("id,name").eq("owner_id", user.id).eq("location_id", loc).eq("active", true).order("name");
    setExistingMenus((em || []) as any);

    const { data: scm } = await supabase.from("staff_channel_mappings").select("external_id")
      .eq("owner_id", user.id).eq("location_id", loc).eq("channel", "salonboard").eq("enabled", true);
    setMappedStaffExt(new Set((scm || []).map((r: any) => String(r.external_id))));
    const { data: mcm } = await supabase.from("menu_channel_mappings").select("external_setmenu_id, external_id, menu_category_cd, net_coupon_id")
      .eq("owner_id", user.id).eq("location_id", loc).eq("channel", "salonboard").eq("enabled", true);
    setMappedMenuExt(new Set((mcm || []).flatMap((r: any) => [r.external_setmenu_id, r.external_id, r.menu_category_cd, r.net_coupon_id]).filter(Boolean).map(String)));
  };

  useEffect(() => { load(); }, [user, locationId, currentLocationId]);

  const fetchStaff = async () => {
    if (!loc) { toast.error("店舗情報が取得できないため、スタッフを取得できません。店舗を選択してください。"); return; }
    setFetching("staff");
    const res = await supabase.functions.invoke("salonboard-fetch-staff", { body: { owner_id: user!.id, location_id: loc } });
    setFetching("");
    if (res.error || res.data?.success === false) {
      toast.error("取得失敗: " + (res.data?.message || res.error?.message || "unknown"));
      return;
    }
    toast.success(`スタッフ ${res.data?.count ?? 0} 件取得`);
    load();
  };
  const fetchMenus = async () => {
    if (!loc) { toast.error("店舗情報が取得できないため、メニューを取得できません。店舗を選択してください。"); return; }
    setFetching("menus");
    const res = await supabase.functions.invoke("salonboard-fetch-menus", { body: { owner_id: user!.id, location_id: loc } });
    setFetching("");
    if (res.error || res.data?.success === false) {
      toast.error("取得失敗: " + (res.data?.message || res.error?.message || "unknown"));
      return;
    }
    toast.success(`メニュー ${res.data?.count ?? 0} 件取得`);
    load();
  };

  const importStaff = async () => {
    const items = staffOpts
      .filter((s) => !mappedStaffExt.has(s.external_staff_id))
      .map((s) => {
        const a = staffActions[s.external_staff_id] || { action: "create" };
        return {
          external_staff_id: s.external_staff_id,
          display_name: s.display_name,
          is_no_designation: s.is_no_designation,
          action: a.action,
          target_staff_id: a.target || null,
        };
      });
    if (items.length === 0) { toast.info("取り込み対象がありません"); return; }
    setImporting(true);
    const res = await supabase.functions.invoke("salonboard-bulk-import-staff", {
      body: { owner_id: user!.id, location_id: loc, items },
    });
    setImporting(false);
    if (res.error) { toast.error(res.error.message); return; }
    const ok = (res.data?.results || []).filter((r: any) => r.status === "ok").length;
    toast.success(`${ok} 件のスタッフを紐付けました`);
    load();
  };

  const importMenus = async () => {
    if (!loc) {
      toast.error("店舗情報が取得できないため、メニューを取り込めません。店舗を選択してください。");
      return;
    }
    const items = menuOpts
      .filter((m) => !mappedMenuExt.has(m.external_menu_id))
      .map((m) => {
        const src = getSrcType(m);
        // 初期は setmenu のみ create、coupon/category はユーザーが明示しない限り skip
        const defaultAction = src === "setmenu" ? "create" : "skip";
        const a = menuActions[m.external_menu_id] || { action: defaultAction };
        const editedTerm = menuRsvTerm[m.external_menu_id];
        const rsv_term = editedTerm === "" || editedTerm === undefined ? m.rsv_term : Number(editedTerm);
        return {
          external_menu_id: m.external_menu_id,
          setmenu_id: m.setmenu_id, menu_id: m.menu_id,
          menu_category_cd: m.menu_category_cd,
          net_coupon_id: m.net_coupon_id ?? null,
          source_type: src,
          menu_name: m.menu_name,
          rsv_term, price: m.price,
          action: a.action, target_menu_id: a.target || null,
        };
      });
    if (items.length === 0) { toast.info("取り込み対象がありません"); return; }
    setImporting(true);
    const res = await supabase.functions.invoke("salonboard-bulk-import-menus", {
      body: { owner_id: user!.id, location_id: loc, items },
    });
    setImporting(false);
    if (res.error) { toast.error(res.error.message); return; }
    const ok = (res.data?.results || []).filter((r: any) => r.status === "ok").length;
    toast.success(`${ok} 件のメニューを紐付けました`);
    load();
  };

  return (
    <div className="container max-w-5xl py-12 px-6 space-y-8">
      <div>
        <div className="text-[10px] tracking-luxury text-gold mb-2">SALONBOARD AUTO MAPPING</div>
        <h1 className="font-serif text-3xl">スタッフ・メニュー自動連携</h1>
        <p className="text-sm text-muted-foreground mt-2">サロンボード側の情報を取得し、SalonBoostへ一括取り込みします。</p>
      </div>

      {/* スタッフ */}
      <Card className="rounded-none p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-xl">スタッフ</h2>
          <Button onClick={fetchStaff} disabled={fetching === "staff" || !loc} className="rounded-none" variant="outline" size="sm">
            {fetching === "staff" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            サロンボードから取得
          </Button>
        </div>
        {staffOpts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">未取得です。「サロンボードから取得」を押してください。</div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {staffOpts.map((s) => {
                const mapped = mappedStaffExt.has(s.external_staff_id);
                const a = staffActions[s.external_staff_id] || { action: "create" };
                return (
                  <div key={s.id} className="grid grid-cols-[1fr_120px_1fr_120px] gap-3 items-center text-sm border-b py-2">
                    <div>
                      <div className="font-medium">{s.display_name}</div>
                      <div className="text-xs text-muted-foreground">stylistId: {s.external_staff_id}{s.is_no_designation && <Badge className="ml-2 rounded-none">指名なし</Badge>}</div>
                    </div>
                    <div className="text-xs">{mapped ? <Badge className="rounded-none bg-emerald-600">紐付済</Badge> : <Badge className="rounded-none" variant="outline">未紐付</Badge>}</div>
                    <div>
                      {!mapped && (
                        <select className="w-full border px-2 py-1 rounded-none text-sm bg-background"
                          value={a.action === "link" ? `link:${a.target}` : a.action}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v.startsWith("link:")) setStaffActions({ ...staffActions, [s.external_staff_id]: { action: "link", target: v.slice(5) } });
                            else setStaffActions({ ...staffActions, [s.external_staff_id]: { action: v } });
                          }}>
                          <option value="create">新規作成</option>
                          <option value="skip">スキップ</option>
                          {existingStaff.map((es) => <option key={es.id} value={`link:${es.id}`}>既存と紐付け: {es.name}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground text-right">{new Date(s.fetched_at).toLocaleString("ja-JP")}</div>
                  </div>
                );
              })}
            </div>
            <Button onClick={importStaff} disabled={importing} className="rounded-none">
              <Upload className="w-4 h-4 mr-2" />一括取り込み・保存
            </Button>
          </>
        )}
      </Card>

      {/* メニュー */}
      <Card className="rounded-none p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-xl">メニュー</h2>
          <Button onClick={fetchMenus} disabled={fetching === "menus" || !loc} className="rounded-none" variant="outline" size="sm">
            {fetching === "menus" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            サロンボードから取得
          </Button>
        </div>
        {!loc && (
          <div className="text-xs border border-amber-500/40 bg-amber-50 text-amber-900 px-3 py-2 mb-4">
            店舗情報が取得できないため、メニューを取り込めません。店舗を選択してください。
          </div>
        )}
        {menuOpts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">未取得です。「サロンボードから取得」を押してください。</div>
        ) : (() => {
          const groups = { setmenu: [] as MenuOpt[], coupon: [] as MenuOpt[], category: [] as MenuOpt[] };
          for (const m of menuOpts) groups[getSrcType(m)].push(m);

          const renderRow = (m: MenuOpt, src: "setmenu" | "coupon" | "category") => {
            const mapped = mappedMenuExt.has(m.external_menu_id);
            const defaultAction = src === "setmenu" ? "create" : "skip";
            const a = menuActions[m.external_menu_id] || { action: defaultAction };
            const warns = src === "coupon" ? detectCouponWarnings(m.menu_name) : [];
            return (
              <div key={m.id} className="grid grid-cols-[1fr_120px_1fr_120px] gap-3 items-center text-sm border-b py-2">
                <div>
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {m.menu_name}
                    {warns.length > 0 && (
                      <Badge variant="outline" className="rounded-none text-[10px] border-amber-500 text-amber-600">
                        要注意: {warns.join("/")}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.setmenu_id && <>setmenuId: {m.setmenu_id} </>}
                    {m.menu_category_cd && <>cat: {m.menu_category_cd} </>}
                    {m.net_coupon_id && <>coupon: {m.net_coupon_id} </>}
                    {m.price && <>/ ¥{m.price.toLocaleString()} </>}
                    <span className="ml-1">所要時間:
                      <input
                        type="number" min={0} step={5}
                        className="ml-1 w-16 border px-1 py-0.5 rounded-none bg-background"
                        value={menuRsvTerm[m.external_menu_id] ?? (m.rsv_term ?? "")}
                        onChange={(e) => setMenuRsvTerm({ ...menuRsvTerm, [m.external_menu_id]: e.target.value === "" ? "" : Number(e.target.value) })}
                      />
                      <span className="ml-1">分</span>
                      {m.rsv_term != null ? (
                        <Badge variant="outline" className="rounded-none ml-2 text-[10px] border-emerald-500 text-emerald-600">自動取得済み</Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-none ml-2 text-[10px] border-amber-500 text-amber-600">未取得 / 手入力してください</Badge>
                      )}
                    </span>
                  </div>
                </div>
                <div>{mapped ? <Badge className="rounded-none bg-emerald-600">紐付済</Badge> : <Badge className="rounded-none" variant="outline">未紐付</Badge>}</div>
                <div>
                  {!mapped && (
                    <select className="w-full border px-2 py-1 rounded-none text-sm bg-background"
                      value={a.action === "link" ? `link:${a.target}` : a.action}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v.startsWith("link:")) setMenuActions({ ...menuActions, [m.external_menu_id]: { action: "link", target: v.slice(5) } });
                        else setMenuActions({ ...menuActions, [m.external_menu_id]: { action: v } });
                      }}>
                      <option value="create">新規作成</option>
                      <option value="skip">スキップ</option>
                      {existingMenus.map((em) => <option key={em.id} value={`link:${em.id}`}>既存と紐付け: {em.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="text-xs text-muted-foreground text-right">{new Date(m.fetched_at).toLocaleString("ja-JP")}</div>
              </div>
            );
          };

          return (
            <>
              <div className="flex gap-4 text-xs mb-4 text-muted-foreground">
                <span>組み合わせメニュー: <b className="text-foreground">{groups.setmenu.length}</b>件</span>
                <span>クーポン: <b className="text-foreground">{groups.coupon.length}</b>件</span>
                <span>カテゴリ: <b className="text-foreground">{groups.category.length}</b>件</span>
              </div>

              <section className="mb-6">
                <div className="text-[10px] tracking-luxury text-gold mb-1">RESERVATION SYNC</div>
                <h3 className="font-serif text-lg mb-1">予約同期用メニュー（組み合わせメニュー）</h3>
                <p className="text-xs text-muted-foreground mb-3">予約同期の本命です。初期状態で取り込み対象になります。</p>
                {groups.setmenu.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-3">該当データなし</div>
                ) : (
                  <div className="space-y-2">{groups.setmenu.map((m) => renderRow(m, "setmenu"))}</div>
                )}
              </section>

              <section className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <div className="text-[10px] tracking-luxury text-muted-foreground mb-1">HOTPEPPER COUPON</div>
                    <h3 className="font-serif text-lg">ホットペッパークーポン</h3>
                  </div>
                  <Button variant="outline" size="sm" className="rounded-none" onClick={() => setShowCoupon((v) => !v)}>
                    {showCoupon ? "折りたたむ" : "表示する"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  条件付きクーポンが多いため、初期状態では同期対象外です。自社アプリでも使うものだけ「新規作成」を選んでください。
                </p>
                {showCoupon && (
                  groups.coupon.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-3">該当データなし</div>
                  ) : (
                    <div className="space-y-2">{groups.coupon.map((m) => renderRow(m, "coupon"))}</div>
                  )
                )}
              </section>

              <section className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <div className="text-[10px] tracking-luxury text-muted-foreground mb-1">CATEGORY</div>
                    <h3 className="font-serif text-lg">カテゴリ</h3>
                  </div>
                  <Button variant="outline" size="sm" className="rounded-none" onClick={() => setShowCategory((v) => !v)}>
                    {showCategory ? "折りたたむ" : "表示する"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  カテゴリ単体では予約同期に使いません。初期状態では同期対象外です。
                </p>
                {showCategory && (
                  groups.category.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-3">該当データなし</div>
                  ) : (
                    <div className="space-y-2">{groups.category.map((m) => renderRow(m, "category"))}</div>
                  )
                )}
              </section>

              <Button onClick={importMenus} disabled={importing || !loc} className="rounded-none">
                <Upload className="w-4 h-4 mr-2" />一括取り込み・保存（初期は組み合わせメニューのみ）
              </Button>
            </>
          );
        })()}
      </Card>
    </div>
  );
}
