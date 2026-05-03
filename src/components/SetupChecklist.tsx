import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantRole } from "@/hooks/useTenant";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";

interface Item {
  key: string;
  label: string;
  done: boolean;
  href: string;
  cta: string;
}

const SetupChecklist = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const dis = localStorage.getItem(`setup_checklist_dismissed_${user.id}`);
    if (dis === "1") { setDismissed(true); return; }
    (async () => {
      const { data: p } = await supabase
        .from("profiles")
        .select("public_slug, inbound_key, line_channel_access_token, line_channel_secret")
        .eq("id", user.id).maybeSingle();
      const { count: menuCount } = await supabase
        .from("menu_items").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
      const { count: staffCount } = await supabase
        .from("staff").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
      const { count: inboundLogCount } = await supabase
        .from("external_reservation_logs").select("id", { count: "exact", head: true }).eq("owner_id", user.id);

      setItems([
        { key: "menus", label: "メニューを3つ以上登録", done: (menuCount ?? 0) >= 3, href: "/menu", cta: "メニューを開く" },
        { key: "staff", label: "スタッフを登録", done: (staffCount ?? 0) >= 1, href: "/staff", cta: "スタッフを開く" },
        { key: "share", label: "公開予約URLをSNS・名刺に掲載", done: !!p?.public_slug, href: "/share", cta: "URLを取得" },
        { key: "inbound", label: "ホットペッパー等の予約通知メール自動取込を設定", done: (inboundLogCount ?? 0) > 0, href: "/settings?tab=connect&section=inbound", cta: "転送先アドレスを見る" },
        { key: "line", label: "LINE公式アカウントを連携", done: !!(p?.line_channel_access_token && p?.line_channel_secret), href: "/settings?tab=connect", cta: "設定を開く" },
      ]);
      setLoading(false);
    })();
  }, [user]);

  if (dismissed || loading || items.length === 0) return null;
  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((doneCount / total) * 100);
  if (pct === 100) return null;

  return (
    <div className="border border-border rounded-md bg-card mb-6">
      <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-sm">セットアップ進捗</h3>
            <span className="text-xs text-muted-foreground">{doneCount} / {total} 完了 ({pct}%)</span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={(e) => { e.stopPropagation(); if (user) { localStorage.setItem(`setup_checklist_dismissed_${user.id}`, "1"); setDismissed(true); } }}
            className="p-1 text-muted-foreground hover:text-foreground"
            aria-label="非表示"
          >
            <X className="w-4 h-4" />
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>
      {open && (
        <div className="border-t border-border p-2">
          {items.map((it) => (
            <div key={it.key} className="flex items-center gap-3 px-2 py-2 hover:bg-secondary/30 rounded">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${it.done ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                {it.done && <Check className="w-3 h-3" />}
              </div>
              <span className={`flex-1 text-sm ${it.done ? "text-muted-foreground line-through" : ""}`}>{it.label}</span>
              {!it.done && (
                <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                  <Link to={it.href}>{it.cta}</Link>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SetupChecklist;
