import { useEffect, useState } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type StepKey = "downloaded" | "opened_extensions" | "dev_mode" | "loaded" | "logged_in" | "scan_success";

const STORAGE_KEY = "sb_onboarding_progress_v1";

interface Props {
  onDownload: () => void;
  downloading: boolean;
}

const HandsOnChecklist = ({ onDownload, downloading }: Props) => {
  const { user } = useAuth();
  const [manual, setManual] = useState<Record<StepKey, boolean>>({
    downloaded: false,
    opened_extensions: false,
    dev_mode: false,
    loaded: false,
    logged_in: false,
    scan_success: false,
  });
  const [autoScan, setAutoScan] = useState(false);

  // Load persisted progress
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setManual((m) => ({ ...m, ...JSON.parse(raw) }));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(manual));
  }, [manual]);

  // Auto-detect: did this user ever successfully ingest from salonboard?
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const check = async () => {
      const { data } = await supabase
        .from("salonboard_import_logs")
        .select("id")
        .eq("owner_id", user.id)
        .in("status", ["success", "partial"])
        .limit(1);
      if (mounted && data && data.length > 0) setAutoScan(true);
    };
    check();
    const t = setInterval(check, 8000);
    return () => { mounted = false; clearInterval(t); };
  }, [user]);

  const toggle = (k: StepKey) => setManual((m) => ({ ...m, [k]: !m[k] }));

  const items: { key: StepKey; label: string; auto?: boolean; action?: { text: string; run: () => void } }[] = [
    {
      key: "downloaded",
      label: "拡張機能をダウンロードした",
      action: { text: downloading ? "DL中..." : "今すぐDL", run: () => { onDownload(); setManual((m) => ({ ...m, downloaded: true })); } },
    },
    {
      key: "opened_extensions",
      label: "chrome://extensions を開いた",
    },
    { key: "dev_mode", label: "デベロッパーモードをONにした" },
    { key: "loaded", label: "解凍したフォルダを読み込んだ" },
    { key: "logged_in", label: "拡張機能にログインして店舗を選んだ" },
    { key: "scan_success", label: "サロンボードからテスト取得が成功した", auto: true },
  ];

  const checked = (k: StepKey) => (k === "scan_success" ? autoScan || manual[k] : manual[k]);
  const completedCount = items.filter((i) => checked(i.key)).length;
  const progress = Math.round((completedCount / items.length) * 100);

  return (
    <div>
      {/* progress */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="eyebrow text-[10px] text-gold">— Progress —</span>
          <span className="font-serif-en text-xs text-muted-foreground">
            {completedCount} / {items.length} ・ {progress}%
          </span>
        </div>
        <div className="h-1 bg-secondary overflow-hidden">
          <div
            className="h-full bg-gold transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <ul className="divide-y divide-border border border-border">
        {items.map((item, idx) => {
          const isChecked = checked(item.key);
          return (
            <li
              key={item.key}
              className={cn(
                "flex items-center gap-4 p-4 transition-colors",
                isChecked && "bg-gold/5"
              )}
            >
              <button
                type="button"
                onClick={() => !item.auto && toggle(item.key)}
                disabled={item.auto}
                className={cn(
                  "shrink-0 w-7 h-7 border flex items-center justify-center transition-all",
                  isChecked ? "bg-gold border-gold" : "border-border hover:border-gold",
                  item.auto && "cursor-default"
                )}
                aria-label={isChecked ? "完了" : "未完了"}
              >
                {isChecked ? (
                  <Check className="w-4 h-4 text-white stroke-[2.5]" />
                ) : item.auto ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <Circle className="w-3 h-3 text-muted-foreground/30" />
                )}
              </button>
              <span className="font-serif-en text-xs text-gold tabular-nums w-6">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className={cn("flex-1 text-sm", isChecked && "text-muted-foreground line-through")}>
                {item.label}
              </span>
              {item.auto && !isChecked && (
                <span className="text-[10px] text-muted-foreground">自動検知中</span>
              )}
              {item.action && !isChecked && (
                <button
                  onClick={item.action.run}
                  disabled={downloading}
                  className="text-[11px] tracking-luxury bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary-glow transition-colors disabled:opacity-50"
                >
                  {item.action.text}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {progress === 100 && (
        <div className="mt-6 border border-gold bg-gold/10 p-6 text-center">
          <div className="text-2xl mb-2">✦</div>
          <p className="display text-lg mb-1">セットアップ完了</p>
          <p className="text-xs text-muted-foreground">
            これで顧客データが自動で Salon Boost に流れ込みます。
          </p>
        </div>
      )}
    </div>
  );
};

export default HandsOnChecklist;
