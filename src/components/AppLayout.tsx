import { ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, Upload, Megaphone, Calendar, LogOut, Share2,
  Settings as SettingsIcon, Mail, MessageCircle, FileText, CalendarClock,
  TrendingUp, Scissors, UserCog, Gift, Inbox, Download, CreditCard, Users2,
  Store, ChevronDown, Sparkles, Building2, BarChart3, ShieldCheck, Radio, FlaskConical, Users as UsersIcon,
  HelpCircle, Plug, AlertTriangle, Menu, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import HelpWidget from "@/components/HelpWidget";
import OnboardingTour from "@/components/OnboardingTour";
import { useTenantRole, useTenantId } from "@/hooks/useTenant";
import { useQuery } from "@tanstack/react-query";
import { useCurrentLocationId } from "@/hooks/useLocations";
import type { TenantRole } from "@/hooks/useTenant";

type NavItem = {
  to: string;
  label: string;
  en: string;
  icon: LucideIcon;
  badgeKey?: "inbox";
  allowedRoles?: TenantRole[];
};

type NavGroup = {
  id: string;
  label: string;
  en: string;
  icon: LucideIcon;
  items: NavItem[];
};

// 毎日使う（常時表示・最上段）
const dailyItems: NavItem[] = [
  { to: "/dashboard", label: "ダッシュボード", en: "Overview", icon: LayoutDashboard },
  { to: "/inbox", label: "受信トレイ", en: "Inbox", icon: Inbox, badgeKey: "inbox" },
  { to: "/calendar", label: "予約カレンダー", en: "Calendar", icon: CalendarClock },
      { to: "/reservations", label: "LINE予約仮受付", en: "LINE Reservations", icon: MessageCircle },
  { to: "/bookings", label: "予約一覧", en: "Bookings", icon: Calendar },
  { to: "/customers", label: "顧客", en: "Guests", icon: Users },
];

// 業務グループ（アコーディオン）
const navGroups: NavGroup[] = [
  {
    id: "outreach",
    label: "集客・販促",
    en: "Outreach",
    icon: Sparkles,
    items: [
      { to: "/campaigns", label: "メール配信", en: "Campaigns", icon: Megaphone },
      { to: "/line-broadcast", label: "LINE配信", en: "LINE Push", icon: MessageCircle },
     { to: "/incentives", label: "特典マスター", en: "Incentives", icon: Gift },
      { to: "/points", label: "ポイント制度", en: "Points", icon: Gift },
      { to: "/templates", label: "テンプレート", en: "Templates", icon: FileText },
      { to: "/schedule", label: "配信予定", en: "Schedule", icon: CalendarClock },
      { to: "/delivery", label: "配信ダッシュボード", en: "Delivery", icon: Radio },
      { to: "/approvals", label: "配信の承認", en: "Approvals", icon: ShieldCheck },
      { to: "/segment-templates", label: "セグメント別文面", en: "Segments", icon: UsersIcon },
      { to: "/ab-tests", label: "A/Bテスト", en: "Experiments", icon: FlaskConical },
    ],
  },
  {
    id: "store",
    label: "店舗運営",
    en: "Store",
    icon: Building2,
    items: [
      { to: "/menu-items", label: "メニュー", en: "Menus", icon: Scissors, allowedRoles: ["owner", "manager", "super_admin"] },
      { to: "/staff", label: "スタッフ", en: "Staff", icon: UserCog, allowedRoles: ["owner", "manager", "super_admin"] },
      { to: "/locations", label: "店舗管理", en: "Locations", icon: Store, allowedRoles: ["owner", "super_admin"] },
      { to: "/share", label: "公開URL", en: "Share", icon: Share2 },
    ],
  },
  {
    id: "analytics",
    label: "分析",
    en: "Analytics",
    icon: BarChart3,
    items: [
      { to: "/performance", label: "効果測定", en: "Performance", icon: TrendingUp },
      { to: "/retention", label: "リピート率", en: "Retention", icon: TrendingUp },
      { to: "/commission", label: "歩合・売上", en: "Commission", icon: BarChart3 },
      { to: "/email-logs", label: "メール履歴", en: "Email Logs", icon: Mail },
    ],
  },
  {
    id: "settings",
    label: "設定",
    en: "Settings",
    icon: SettingsIcon,
    items: [
      { to: "/settings", label: "基本設定", en: "General", icon: SettingsIcon },
      { to: "/team", label: "チーム", en: "Team", icon: Users2, allowedRoles: ["owner", "manager", "super_admin"] },
      { to: "/billing", label: "契約・支払い", en: "Billing", icon: CreditCard, allowedRoles: ["owner", "super_admin"] },
      { to: "/import", label: "インポート", en: "Import", icon: Upload, allowedRoles: ["owner", "manager", "super_admin"] },
      { to: "/inbound-logs", label: "予約取込ログ", en: "Inbound Logs", icon: Radio },
      { to: "/salonboard-export", label: "サロンボード抽出", en: "SB Export", icon: Download },
      { to: "/channel-integrations", label: "外部媒体連携", en: "Integrations", icon: Plug, allowedRoles: ["owner", "manager", "super_admin"] },
      { to: "/sync-review", label: "要確認キュー", en: "Sync Review", icon: AlertTriangle, allowedRoles: ["owner", "manager", "super_admin"] },
    ],
  },
];

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [unreadInbox, setUnreadInbox] = useState(0);
  const role = useTenantRole();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // 現在所属サロン名 + 自分のプロフィール
  const { data: account } = useQuery({
    queryKey: ["sidebar-account", user?.id, tenantId],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const [{ data: myProfile }, tenantProfileRes] = await Promise.all([
        supabase.from("profiles").select("full_name, salon_name").eq("id", user.id).maybeSingle(),
        tenantId
          ? supabase.from("profiles").select("salon_name").eq("id", tenantId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        userName: myProfile?.full_name || user.email?.split("@")[0] || "ユーザー",
        userEmail: user.email ?? "",
        salonName: tenantProfileRes.data?.salon_name || myProfile?.salon_name || "（サロン未設定）",
      };
    },
  });

  const roleLabel =
    role === "owner" ? "オーナー" :
    role === "manager" ? "マネージャー" :
    role === "staff" ? "スタッフ" :
    role === "super_admin" ? "管理者" : "";

  // どのグループに現在ルートが含まれるか
  const activeGroupId = useMemo(() => {
    const g = navGroups.find((g) => g.items.some((i) => pathname.startsWith(i.to)));
    return g?.id ?? null;
  }, [pathname]);

  // 開閉状態（永続化）
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("nav.openGroups");
      if (raw) return JSON.parse(raw);
    } catch {
      // Continue with the default navigation state when storage is unavailable.
    }
    return {};
  });

  // アクティブグループは自動展開
  useEffect(() => {
    if (activeGroupId && !openGroups[activeGroupId]) {
      setOpenGroups((prev) => ({ ...prev, [activeGroupId]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

  useEffect(() => {
    try {
      localStorage.setItem("nav.openGroups", JSON.stringify(openGroups));
    } catch {
      // Navigation remains usable when storage is unavailable.
    }
  }, [openGroups]);

  useEffect(() => {
    if (!user || !tenantId || !locationId) {
      setUnreadInbox(0);
      return;
    }
    const fetchUnread = async () => {
      const { count } = await supabase
        .from("line_inbound_messages")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", tenantId)
        .eq("location_id", locationId)
        .eq("handled", false);
      setUnreadInbox(count || 0);
    };
    fetchUnread();
    const ch = supabase
      .channel("inbox-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "line_inbound_messages" }, fetchUnread)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, tenantId, locationId]);

  useEffect(() => setMobileNavOpen(false), [pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const renderItem = (item: NavItem, opts: { nested?: boolean } = {}) => {
    if (item.allowedRoles && (!role || !item.allowedRoles.includes(role))) return null;
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) =>
          cn(
            "group flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-300 relative",
            opts.nested && "pl-10",
            isActive
              ? "text-gold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-px before:h-5 before:bg-[hsl(var(--gold))]"
              : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
          )
        }
      >
        <Icon className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-serif text-[13px] tracking-wider truncate">{item.label}</span>
          <span className="eyebrow text-[9px] text-sidebar-foreground/40 truncate">{item.en}</span>
        </div>
        {item.badgeKey === "inbox" && unreadInbox > 0 && (
          <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 bg-gold text-background rounded-sm min-w-[20px] text-center">
            {unreadInbox > 99 ? "99+" : unreadInbox}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <div className="min-h-screen bg-background flex">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="メニューを閉じる"
          className="fixed inset-0 z-40 bg-black/45 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border transition-transform duration-200 md:static md:translate-x-0",
        mobileNavOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="relative px-8 py-8 border-b border-sidebar-border/60">
          <div className="font-serif-en text-3xl text-gold tracking-luxury mb-1">SB</div>
          <div className="font-serif text-sm tracking-wider">Salon Boost</div>
          <div className="eyebrow text-[10px] text-sidebar-foreground/50 mt-1">Est. 2026</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 text-sidebar-foreground md:hidden"
            aria-label="メニューを閉じる"
            onClick={() => setMobileNavOpen(false)}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="border-b border-sidebar-border/60">
          <LocationSwitcher />
        </div>

        <nav className="flex-1 overflow-y-auto py-4 space-y-1">
          {/* Daily（常時表示） */}
          <div className="px-4 pb-2" data-tour="nav-daily">
            <p className="eyebrow text-[9px] text-sidebar-foreground/40 px-4 mb-1">— Daily —</p>
            {dailyItems.map((item) => renderItem(item))}
          </div>

          {/* Groups */}
          <div className="px-4 pt-2 border-t border-sidebar-border/40 space-y-0.5" data-tour="nav-groups">
            {navGroups.map((group) => {
              const GroupIcon = group.icon;
              const isOpen = openGroups[group.id] ?? group.id === activeGroupId;
              const groupHasActive = group.id === activeGroupId;
              return (
                <Collapsible
                  key={group.id}
                  open={isOpen}
                  onOpenChange={(v) => setOpenGroups((prev) => ({ ...prev, [group.id]: v }))}
                >
                  <CollapsibleTrigger
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-300",
                      "hover:text-sidebar-foreground",
                      groupHasActive ? "text-gold/90" : "text-sidebar-foreground/60"
                    )}
                  >
                    <GroupIcon className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                    <div className="flex flex-col flex-1 text-left min-w-0">
                      <span className="font-serif text-[13px] tracking-wider truncate">{group.label}</span>
                      <span className="eyebrow text-[9px] text-sidebar-foreground/40 truncate">{group.en}</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        "w-3 h-3 stroke-[1.5] transition-transform duration-300 shrink-0",
                        isOpen && "rotate-180"
                      )}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                    <div className="space-y-0.5 pb-1 pt-0.5">
                      {group.items.map((item) => renderItem(item, { nested: true }))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </nav>

        {/* Account info — 誤操作防止のため常時表示 */}
        {user && (
          <div className="px-4 py-3 border-t border-sidebar-border/60 bg-sidebar-accent/30">
            <p className="eyebrow text-[9px] text-sidebar-foreground/40 mb-1">— Signed in as —</p>
            <p className="font-serif text-[13px] text-gold tracking-wider truncate" title={account?.salonName}>
              {account?.salonName ?? "..."}
            </p>
            <p className="text-[11px] text-sidebar-foreground/80 truncate mt-0.5" title={account?.userName}>
              {account?.userName ?? ""}
              {roleLabel && <span className="ml-1.5 text-[9px] text-sidebar-foreground/50">／{roleLabel}</span>}
            </p>
            <p className="text-[10px] text-sidebar-foreground/50 truncate font-mono" title={account?.userEmail}>
              {account?.userEmail}
            </p>
          </div>
        )}

        <div className="p-4 border-t border-sidebar-border/60 space-y-1">
          <NavLink
            to="/help"
            className={({ isActive }) =>
              cn(
                "w-full flex items-center gap-2 px-3 py-2 text-xs tracking-luxury transition-colors rounded-none",
                isActive ? "text-gold" : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
              )
            }
          >
            <HelpCircle className="w-3.5 h-3.5 stroke-[1.5]" />
            ヘルプ <span className="ml-auto opacity-50 text-[9px]">HELP</span>
          </NavLink>
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent text-xs tracking-luxury rounded-none"
            onClick={handleSignOut}
          >
            <LogOut className="w-3.5 h-3.5 mr-2 stroke-[1.5]" />
            ログアウト <span className="ml-2 opacity-50 text-[9px]">SIGN OUT</span>
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
          <Button type="button" variant="ghost" size="icon" aria-label="メニューを開く" onClick={() => setMobileNavOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="text-center">
            <p className="font-serif text-sm tracking-wider">Salon Boost</p>
            <p className="text-[9px] text-muted-foreground">{account?.salonName ?? ""}</p>
          </div>
          <div className="w-10" aria-hidden="true" />
        </header>
        <div className="container mx-auto px-4 py-6 md:px-12 md:py-12 max-w-7xl animate-fade-in">{children}</div>
      </main>

      <HelpWidget />
      <OnboardingTour />
    </div>
  );
};

export default AppLayout;
