import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type TenantRole = "owner" | "manager" | "staff" | "super_admin";

export interface TenantMembership {
  tenant_id: string;
  role: TenantRole;
  accepted_at: string | null;
}

/**
 * 現在ログインしているユーザーが所属するテナント（= サロン）の情報を返す。
 * オーナーなら自分自身のIDが tenant_id になる。
 */
export const useTenant = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["tenant", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<TenantMembership | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("tenant_members")
        .select("tenant_id, role, accepted_at")
        .eq("user_id", user.id)
        .not("accepted_at", "is", null)
        .order("role", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as TenantMembership | null;
    },
  });
};

/**
 * 現在のテナントIDだけ欲しい時のショートカット
 */
export const useTenantId = (): string | null => {
  const { data } = useTenant();
  return data?.tenant_id ?? null;
};

/**
 * 現在のロール
 */
export const useTenantRole = (): TenantRole | null => {
  const { data } = useTenant();
  return (data?.role as TenantRole | undefined) ?? null;
};

const ROLE_RANK: Record<TenantRole, number> = {
  staff: 1,
  manager: 2,
  owner: 3,
  super_admin: 4,
};

export const hasMinRole = (role: TenantRole | null, min: TenantRole): boolean => {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
};
