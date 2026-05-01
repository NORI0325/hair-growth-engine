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
}

const STORAGE_KEY = "salon-boost:current-location-id";

/**
 * 現在ログイン中のユーザーがアクセスできる店舗一覧。
 * オーナー/マネージャーは tenant 内の全店舗、スタッフは location_members に紐づく店舗。
 */
export const useLocations = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();

  return useQuery({
    queryKey: ["locations", tenantId, user?.id],
    enabled: !!user && !!tenantId,
    queryFn: async (): Promise<Location[]> => {
      if (!tenantId) return [];
      // RLS が「テナント所属者は閲覧可能」なので tenant_id でフィルタ
      const { data, error } = await supabase
        .from("locations")
        .select("id, tenant_id, name, public_slug, is_primary, created_at")
        .eq("tenant_id", tenantId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Location[];
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
  locations: Location[];
  isLoading: boolean;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useLocations();
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  // 初回ロード or 現在のIDが利用可能店舗にない場合、primaryまたは先頭にフォールバック
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

  const setCurrentLocationId = (id: string) => {
    setCurrentLocationIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
    // 店舗切り替え時に各種クエリを無効化
    queryClient.invalidateQueries();
  };

  const currentLocation = useMemo(
    () => locations.find((l) => l.id === currentLocationId) ?? null,
    [locations, currentLocationId]
  );

  return (
    <LocationContext.Provider
      value={{ currentLocationId, currentLocation, setCurrentLocationId, locations, isLoading }}
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
      locations: [],
      isLoading: false,
    };
  }
  return ctx;
};

export const useCurrentLocationId = (): string | null => {
  return useCurrentLocation().currentLocationId;
};
