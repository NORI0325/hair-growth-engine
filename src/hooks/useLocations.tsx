import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
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

const sortLocations = (locations: Location[]) =>
  [...locations].sort((a, b) => {
    const primaryDiff = Number(b.is_primary) - Number(a.is_primary);
    if (primaryDiff !== 0) return primaryDiff;
    return (a.created_at || a.name).localeCompare(b.created_at || b.name);
  });

const mergeLocations = (...groups: Location[][]): Location[] => {
  const byId = new Map<string, Location>();
  groups.flat().forEach((location) => {
    const normalized = normalizeLocation(location);
    const existing = byId.get(normalized.id);
    byId.set(normalized.id, existing ? { ...existing, ...normalized } : normalized);
  });
  return sortLocations(Array.from(byId.values()));
};

const chooseDefaultLocation = (locations: Location[]): Location | null => {
  const arunePrimary = locations.find((l) => l.is_primary && l.name.trim().toLowerCase() === "arune hair");
  return arunePrimary ?? locations.find((l) => l.is_primary) ?? locations[0] ?? null;
};

const recoverLocationsFromBackend = async (tenantId: string): Promise<Location[]> => {
  const { data, error } = await supabase.functions.invoke("recover-locations", {
    body: { tenant_id: tenantId },
  });

  if (error || data?.error) {
    console.warn("[locations] backend recovery failed", {
      tenantId,
      message: data?.error ?? error?.message,
    });
    return [];
  }

  return ((data?.locations ?? []) as Location[])
    .filter((location) => location?.tenant_id === tenantId)
    .map(normalizeLocation);
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
      if (error) {
        console.warn("[locations] direct fetch failed", {
          authUserId: user?.id ?? null,
          tenantId,
          message: error.message,
        });
      }

      const directLocations = error ? [] : ((data ?? []) as Location[]).map(normalizeLocation);

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
      const mergedBeforeRecovery = mergeLocations(
        directLocations,
        restored,
        restoredFromAddLocation ? [restoredFromAddLocation] : []
      );
      const recovered = await recoverLocationsFromBackend(tenantId);
      const finalLocations = mergeLocations(mergedBeforeRecovery, recovered);
      const primaryLocation = chooseDefaultLocation(finalLocations);

      console.info("[locations] fetch diagnostics", {
        authUserId: user?.id ?? null,
        tenantId,
        companyId: null,
        primaryLocationId: primaryLocation?.id ?? null,
        fetchedLocationsCount: directLocations.length,
        fallbackLocationsCount: restored.length,
        backendRecoveredCount: recovered.length,
        finalLocationsCount: finalLocations.length,
        selectedCurrentLocationId: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
        availableLocations: finalLocations.map((l) => ({ id: l.id, name: l.name, isPrimary: l.is_primary })),
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
  const hasRestoredInitialLocation = useRef(false);
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  const locations = useMemo(() => {
    return mergeLocations(optimisticLocations, queriedLocations);
  }, [optimisticLocations, queriedLocations]);

  const defaultLocation = useMemo(() => chooseDefaultLocation(locations), [locations]);
  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === currentLocationId) ?? null,
    [locations, currentLocationId]
  );
  const effectiveCurrentLocationId = locations.length > 0 && (!hasRestoredInitialLocation.current || !selectedLocation)
    ? defaultLocation?.id ?? currentLocationId
    : currentLocationId;

  // 初回ロード or 現在のIDが利用可能店舗にない場合、DBで取得できたprimary店舗をlocalStorageより優先して復元
  useEffect(() => {
    if (locations.length === 0) return;
    const stillValid = currentLocationId && locations.some((l) => l.id === currentLocationId);
    const primary = defaultLocation;
    const shouldPreferPrimary = !hasRestoredInitialLocation.current;
    if (primary && (!stillValid || (shouldPreferPrimary && currentLocationId !== primary.id))) {
      hasRestoredInitialLocation.current = true;
      console.info("[locations] currentLocationId restore", {
        before: currentLocationId,
        after: primary.id,
        localStorageCurrentLocationId: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
        selectedLocationName: primary.name,
        reason: stillValid ? "initial_primary_preferred_over_local_storage" : "missing_or_empty_local_storage",
        availableLocations: locations.map((l) => ({ id: l.id, name: l.name, isPrimary: l.is_primary })),
      });
      setCurrentLocationIdState(primary.id);
      localStorage.setItem(STORAGE_KEY, primary.id);
      // フォールバック発動時も依存クエリを再フェッチさせる
      queryClient.invalidateQueries();
    }
    hasRestoredInitialLocation.current = true;
  }, [locations, currentLocationId, defaultLocation, queryClient]);

  useEffect(() => {
    if (locations.length === 0 || !currentLocationId) return;
    const selected = locations.find((l) => l.id === currentLocationId);
    const primary = defaultLocation;
    if (!primary) return;
    if (!selected || (selected.tenant_id !== primary.tenant_id)) {
      console.info("[locations] invalid currentLocationId replaced", {
        before: currentLocationId,
        after: primary.id,
        localStorageCurrentLocationId: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
        selectedLocationName: primary.name,
        reason: !selected ? "missing_from_locations" : "tenant_mismatch",
      });
      setCurrentLocationIdState(primary.id);
      localStorage.setItem(STORAGE_KEY, primary.id);
      queryClient.invalidateQueries();
    }
  }, [locations, currentLocationId, defaultLocation, queryClient]);

  const setCurrentLocationId = (id: string) => {
    hasRestoredInitialLocation.current = true;
    const selected = locations.find((l) => l.id === id) ?? null;
    console.info("[locations] manual selection", {
      before: currentLocationId,
      after: id,
      selectedLocationName: selected?.name ?? null,
      localStorageCurrentLocationId: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
    });
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
      return mergeLocations([normalized], withoutDuplicate);
    });
    setCurrentLocationId(normalized.id);
  };

  const currentLocation = useMemo(
    () => locations.find((l) => l.id === effectiveCurrentLocationId) ?? null,
    [locations, effectiveCurrentLocationId]
  );

  return (
    <LocationContext.Provider
      value={{ currentLocationId: effectiveCurrentLocationId, currentLocation, setCurrentLocationId, selectLocation: setCurrentLocationId, upsertLocation, locations, isLoading }}
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
