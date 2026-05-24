import { supabase } from "@/integrations/supabase/client";

export interface LineLinkConfig {
  configured: boolean;
  liffId: string | null;
}

let configPromise: Promise<LineLinkConfig> | null = null;

const normalizeConfig = (data: any): LineLinkConfig => {
  const liffId = typeof data?.liffId === "string" ? data.liffId.trim() : "";
  return {
    configured: Boolean(data?.configured && liffId),
    liffId: liffId || null,
  };
};

export const getLineLinkConfig = () => {
  if (!configPromise) {
    configPromise = supabase.functions
      .invoke("line-link-config")
      .then(({ data, error }) => {
        if (error) throw error;
        return normalizeConfig(data);
      })
      .catch((error) => {
        configPromise = null;
        throw error;
      });
  }

  return configPromise;
};
