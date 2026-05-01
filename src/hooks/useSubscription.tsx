import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenant";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused"
  | "locked";

export interface Subscription {
  owner_id: string;
  status: SubscriptionStatus;
  plan: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export const useSubscription = () => {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["subscription", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<Subscription | null> => {
      if (!tenantId) return null;
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("owner_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data as Subscription | null;
    },
  });
};

export const isActiveSubscription = (sub: Subscription | null | undefined): boolean => {
  if (!sub) return false;
  if (sub.status === "active" || sub.status === "trialing") return true;
  return false;
};

export const trialDaysRemaining = (sub: Subscription | null | undefined): number | null => {
  if (!sub || sub.status !== "trialing" || !sub.trial_ends_at) return null;
  const ms = new Date(sub.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};
