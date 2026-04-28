import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, Upload, Megaphone, Calendar, LogOut, Share2, Settings as SettingsIcon, Mail, MessageCircle, FileText, CalendarClock, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "ダッシュボード", en: "Overview", icon: LayoutDashboard },
  { to: "/customers", label: "顧客", en: "Guests", icon: Users },
  { to: "/import", label: "インポート", en: "Import", icon: Upload },
  { to: "/templates", label: "テンプレート", en: "Templates", icon: FileText },
  { to: "/campaigns", label: "メール配信", en: "Outreach", icon: Megaphone },
  { to: "/line-broadcast", label: "LINE配信", en: "LINE Push", icon: MessageCircle },
  { to: "/schedule", label: "配信予定", en: "Schedule", icon: CalendarClock },
  { to: "/performance", label: "効果測定", en: "Performance", icon: TrendingUp },
  { to: "/bookings", label: "予約", en: "Bookings", icon: Calendar },
  { to: "/email-logs", label: "メール履歴", en: "Email Logs", icon: Mail },
  { to: "/share", label: "公開URL", en: "Share", icon: Share2 },
  { to: "/settings", label: "設定", en: "Settings", icon: SettingsIcon },
];

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        <div className="px-8 py-10 border-b border-sidebar-border/60">
          <div className="font-serif-en text-3xl text-gold tracking-luxury mb-1">SB</div>
          <div className="font-serif text-sm tracking-wider">Salon Boost</div>
          <div className="eyebrow text-[10px] text-sidebar-foreground/50 mt-1">Est. 2026</div>
        </div>

        <nav className="flex-1 px-4 py-8 space-y-1">
          {navItems.map(({ to, label, en, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-4 px-4 py-3 text-sm transition-all duration-300 relative",
                  isActive
                    ? "text-gold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-px before:h-6 before:bg-[hsl(var(--gold))]"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
                )
              }
            >
              <Icon className="w-3.5 h-3.5 stroke-[1.5]" />
              <div className="flex flex-col">
                <span className="font-serif text-[13px] tracking-wider">{label}</span>
                <span className="eyebrow text-[9px] text-sidebar-foreground/40">{en}</span>
              </div>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border/60">
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

      <main className="flex-1 overflow-auto">
        <div className="container mx-auto px-12 py-12 max-w-7xl animate-fade-in">{children}</div>
      </main>
    </div>
  );
};

export default AppLayout;
