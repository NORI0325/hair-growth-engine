import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenant";

export interface Location {
  id: string;
  tenant_id: string;
  name: string;
  public_slug: string | null;
  is_primary: boolean;
  created_at: string;
  active?: boolean;
  company_id?: string | null;
  owner_id?: string | null;
  user_id?: string | null;
}

const STORAGE_KEY = "salon-boost:current-location-id";
const RESTORED_LOCATION_KEY = "salon-boost:restored-location";

const normalizeLocation = (location: Partial<Location> & { id: string; tenant_id: string; name: string }): Location => ({
  id: location.id,
  tenant_id: location.tenant_id,
  name: location.name,
  public_slug: location.public_slug ?? null,
  is_primary: Boolean(location.is_primary),
  created_at: location.created_at ?? "",
  active: location.active ?? true,
  company_id: location.company_id ?? null,
  owner_id: location.owner_id ?? location.tenant_id,
  user_id: location.user_id ?? null,
});

const readRestoredLocation = (tenantId: string | null): Location | null => {
  if (typeof window === "undefined" || !tenantId) return null;
  try {
    const raw = localStorage.getItem(RESTORED_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Location;
    if (!parsed?.id || parsed.tenant_id !== tenantId) return null;
    return normalizeLocation(parsed);
  } catch {
    return null;
  }
};

const writeRestoredLocation = (location: Location) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(RESTORED_LOCATION_KEY, JSON.stringify(normalizeLocation(location)));
};

/**
 * 現在ログイン中のユーザーがアクセスできる店舗一覧。
 * オーナー/マネージャーは tenant 内の全店舗、スタッフは location_members に紐づく店舗。
 */
export const useLocations = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();

  return useQuery({
    queryKey: ["locations", tenantId, user?.id],
    // public_slug 付き店舗が公開予約用に読めるため、tenantId 確定前には取得しない。
    enabled: !!user && !!tenantId,
    queryFn: async (): Promise<Location[]> => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("locations")
        .select("id, tenant_id, name, public_slug, is_primary, created_at")
        .eq("tenant_id", tenantId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;

      const directLocations = ((data ?? []) as Location[]).map(normalizeLocation);
      const primaryLocationId = directLocations.find((l) => l.is_primary)?.id ?? directLocations[0]?.id ?? null;
      if (directLocations.length > 0) {
        console.info("[locations] fetch diagnostics", {
          authUserId: user?.id ?? null,
          tenantId,
          companyId: null,
          primaryLocationId,
          fetchedLocationsCount: directLocations.length,
          fallbackLocationsCount: 0,
          finalLocationsCount: directLocations.length,
          selectedCurrentLocationId: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
        });
        return directLocations;
      }

      // RLS/所属紐付けの一時的なズレで通常取得が空になるケースに備え、
      // 認証ユーザー自身の所属店舗だけを返すDB関数で復元する。
      const { data: memberLocations, error: rpcError } = await (supabase as any)
        .rpc("get_my_member_locations");
      if (rpcError) {
        console.warn("[locations] fallback rpc failed", {
          authUserId: user?.id ?? null,
          tenantId,
          message: rpcError.message,
        });
      }

      const restored = (rpcError ? [] : ((memberLocations ?? []) as Array<{
        id: string;
        tenant_id: string;
        name: string;
        is_primary: boolean;
      }>))
        .filter((l) => l.tenant_id === tenantId)
        .map((l) => normalizeLocation({
          id: l.id,
          tenant_id: l.tenant_id,
          name: l.name,
          public_slug: null,
          is_primary: l.is_primary,
          created_at: "",
        }));

      const restoredFromAddLocation = readRestoredLocation(tenantId);
      const finalLocations = restored.length > 0
        ? restored
        : restoredFromAddLocation
          ? [restoredFromAddLocation]
          : [];

      console.info("[locations] fetch diagnostics", {
        authUserId: user?.id ?? null,
        tenantId,
        companyId: null,
        primaryLocationId: finalLocations.find((l) => l.is_primary)?.id ?? finalLocations[0]?.id ?? null,
        fetchedLocationsCount: directLocations.length,
        fallbackLocationsCount: restored.length,
        finalLocationsCount: finalLocations.length,
        selectedCurrentLocationId: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
      });

      if (finalLocations.length === 0) {
        console.warn("[locations] no visible locations for current tenant", {
          tenantId,
          userId: user?.id,
          directCount: directLocations.length,
          rpcCount: memberLocations?.length ?? 0,
        });
      }

      return finalLocations as Location[];
    },
  });
};

// =============================================
// CurrentLocation Context
// =============================================

interface LocationContextValue {
  currentLocationId: string | null;
  currentLocation: Location | null;
  setCurrentLocationId: (id: string) => void;
  selectLocation: (id: string) => void;
  upsertLocation: (location: Location) => void;
  locations: Location[];
  isLoading: boolean;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { data: queriedLocations = [], isLoading } = useLocations();
  const [optimisticLocations, setOptimisticLocations] = useState<Location[]>([]);
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  const locations = useMemo(() => {
    const merged = [...optimisticLocations, ...queriedLocations];
    const seen = new Set<string>();
    return merged
      .filter((location) => {
        if (seen.has(location.id)) return false;
        seen.add(location.id);
        return true;
      })
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  }, [optimisticLocations, queriedLocations]);

  // 初回ロード or 現在のIDが利用可能店舗にない場合、DBで取得できた店舗をlocalStorageより優先して復元
  useEffect(() => {
    if (locations.length === 0) return;
    const stillValid = currentLocationId && locations.some((l) => l.id === currentLocationId);
    if (!stillValid) {
      const primary = locations.find((l) => l.is_primary) ?? locations[0];
      setCurrentLocationIdState(primary.id);
      localStorage.setItem(STORAGE_KEY, primary.id);
      // フォールバック発動時も依存クエリを再フェッチさせる
      queryClient.invalidateQueries();
    }
  }, [locations, currentLocationId, queryClient]);

  useEffect(() => {
    if (locations.length === 0 || !currentLocationId) return;
    const selected = locations.find((l) => l.id === currentLocationId);
    const primary = locations.find((l) => l.is_primary) ?? locations[0];
    if (!selected || (selected.tenant_id !== primary.tenant_id)) {
      setCurrentLocationIdState(primary.id);
      localStorage.setItem(STORAGE_KEY, primary.id);
      queryClient.invalidateQueries();
    }
  }, [locations, currentLocationId, queryClient]);

  const setCurrentLocationId = (id: string) => {
    setCurrentLocationIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
    // 店舗切り替え時に各種クエリを無効化
    queryClient.invalidateQueries();
  };

  const upsertLocation = (location: Location) => {
    const normalized = normalizeLocation(location);
    writeRestoredLocation(normalized);
    setOptimisticLocations((old) => [normalized, ...old.filter((l) => l.id !== normalized.id)]);
    queryClient.setQueriesData<Location[]>({ queryKey: ["locations"] }, (old = []) => {
      const withoutDuplicate = old.filter((l) => l.id !== normalized.id);
      return [normalized, ...withoutDuplicate].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    });
    setCurrentLocationId(normalized.id);
  };

  const currentLocation = useMemo(
    () => locations.find((l) => l.id === currentLocationId) ?? null,
    [locations, currentLocationId]
  );

  return (
    <LocationContext.Provider
      value={{ currentLocationId, currentLocation, setCurrentLocationId, selectLocation: setCurrentLocationId, upsertLocation, locations, isLoading }}
    >
      {children}
    </LocationContext.Provider>
  );
};

export const useCurrentLocation = (): LocationContextValue => {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    // Provider外でも安全にフォールバック (テストや認証外ページ)
    return {
      currentLocationId: null,
      currentLocation: null,
      setCurrentLocationId: () => {},
      selectLocation: () => {},
      upsertLocation: () => {},
      locations: [],
      isLoading: false,
    };
  }
  return ctx;
};

export const useCurrentLocationId = (): string | null => {
  return useCurrentLocation().currentLocationId;
};
