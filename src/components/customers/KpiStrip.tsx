import { cn } from "@/lib/utils";

export type FilterChipKey =
  | "all"
  | "active"
  | "at_risk"
  | "dormant"
  | "new"
  | "birthday"
  | "no_line"
  | "vip";

interface KpiItem {
  key: FilterChipKey;
  label: string;
  en: string;
  count: number;
  tone?: "default" | "warn" | "danger" | "gold" | "line";
}

interface Props {
  items: KpiItem[];
  active: FilterChipKey;
  onSelect: (k: FilterChipKey) => void;
}

const toneClass: Record<NonNullable<KpiItem["tone"]>, string> = {
  default: "text-foreground",
  warn: "text-warning",
  danger: "text-destructive",
  gold: "text-gold",
  line: "text-[#06C755]",
};

const KpiStrip = ({ items, active, onSelect }: Props) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px bg-border border border-border mb-8">
      {items.map((it) => {
        const isActive = active === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onSelect(it.key)}
            className={cn(
              "bg-background text-left p-4 transition-colors group",
              isActive ? "bg-gold/5 ring-1 ring-gold ring-inset" : "hover:bg-secondary/40"
            )}
          >
            <p className={cn(
              "eyebrow text-[9px] mb-1.5 transition-colors",
              isActive ? "text-gold" : "text-muted-foreground group-hover:text-gold"
            )}>
              — {it.en} —
            </p>
            <div className="flex items-baseline gap-1.5">
              <span className={cn("font-serif-en text-2xl tabular-nums", toneClass[it.tone || "default"])}>
                {it.count.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground">名</span>
            </div>
            <p className="text-[11px] mt-0.5 text-muted-foreground">{it.label}</p>
          </button>
        );
      })}
    </div>
  );
};

export default KpiStrip;
