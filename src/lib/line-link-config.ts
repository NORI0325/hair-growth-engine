import { supabase } from "@/integrations/supabase/client";

export interface LineLinkConfig {
  configured: boolean;
  liffId: string | null;
  publicAppOrigin: string | null;
  lineAddFriendUrl: string | null;
}

const configPromises = new Map<string, Promise<LineLinkConfig>>();

const isLiffEnabled = () => {
  const value = String(import.meta.env.VITE_LINE_LIFF_ENABLED || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
};

const normalizeConfig = (data: any): LineLinkConfig => {
  const rawLiffId = typeof data?.liffId === "string" ? data.liffId.trim() : "";
  const liffId = isLiffEnabled() ? rawLiffId : "";
  const publicAppOrigin = typeof data?.publicAppOrigin === "string" ? data.publicAppOrigin.trim().replace(/\/+$/, "") : "";
  const lineAddFriendUrl = typeof data?.lineAddFriendUrl === "string" ? data.lineAddFriendUrl.trim() : "";
  return {
    configured: Boolean(data?.configured && liffId),
    liffId: liffId || null,
    publicAppOrigin: publicAppOrigin || null,
    lineAddFriendUrl: lineAddFriendUrl || null,
  };
};

export const getLineLinkConfig = (token?: string) => {
  const cacheKey = token || "__global__";
  if (!configPromises.has(cacheKey)) {
    const configPromise = supabase.functions
      .invoke("line-link-config", token ? { body: { token } } : undefined)
      .then(({ data, error }) => {
        if (error) throw error;
        return normalizeConfig(data);
      })
      .catch((error) => {
        configPromises.delete(cacheKey);
        throw error;
      });

    configPromises.set(cacheKey, configPromise);
  }

  return configPromises.get(cacheKey)!;
};
