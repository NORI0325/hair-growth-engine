-- 同一テナント内で店舗名を一意にする
CREATE UNIQUE INDEX IF NOT EXISTS locations_tenant_name_unique
  ON public.locations (tenant_id, lower(name));