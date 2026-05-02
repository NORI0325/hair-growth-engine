-- 外部予約取込で location_id が NULL になっていた予約・顧客に、各オーナーのプライマリ店舗を補完
WITH primary_loc AS (
  SELECT DISTINCT ON (tenant_id) tenant_id AS owner_id, id AS location_id
  FROM public.locations
  ORDER BY tenant_id, is_primary DESC, created_at ASC
)
UPDATE public.bookings b
   SET location_id = pl.location_id
  FROM primary_loc pl
 WHERE b.location_id IS NULL
   AND b.owner_id = pl.owner_id
   AND b.external_source IS NOT NULL;

WITH primary_loc AS (
  SELECT DISTINCT ON (tenant_id) tenant_id AS owner_id, id AS location_id
  FROM public.locations
  ORDER BY tenant_id, is_primary DESC, created_at ASC
)
UPDATE public.customers c
   SET location_id = pl.location_id
  FROM primary_loc pl
 WHERE c.location_id IS NULL
   AND c.owner_id = pl.owner_id
   AND c.imported_from IN ('hotpepper','minimo','rakuten_beauty');