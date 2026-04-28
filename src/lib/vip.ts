export type VipTier = "bronze" | "silver" | "gold" | "platinum";

export const calculateVipTier = (visits: number, spent: number): VipTier => {
  if (spent >= 300000 || visits >= 30) return "platinum";
  if (spent >= 150000 || visits >= 15) return "gold";
  if (spent >= 50000 || visits >= 5) return "silver";
  return "bronze";
};

export const tierInfo: Record<VipTier, { label: string; en: string; color: string; bg: string }> = {
  platinum: { label: "プラチナ", en: "Platinum", color: "text-foreground", bg: "bg-gradient-to-r from-gold/40 to-gold/10" },
  gold:     { label: "ゴールド", en: "Gold",     color: "text-gold",       bg: "bg-gold/10" },
  silver:   { label: "シルバー", en: "Silver",   color: "text-muted-foreground", bg: "bg-muted/50" },
  bronze:   { label: "ブロンズ", en: "Bronze",   color: "text-muted-foreground/70", bg: "" },
};

export const isBirthdayMonth = (birthday: string | null): boolean => {
  if (!birthday) return false;
  const m = new Date(birthday).getMonth();
  return m === new Date().getMonth();
};
