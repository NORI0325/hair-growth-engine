-- 現在の制約を確認済み:
-- CHECK ((source_channel = ANY (ARRAY['salonboard','rakuten_beauty','line_reservation','google_reservation','own_web','phone','manual'])))
-- 'line' が含まれていないため追加する

ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_source_channel_check;

ALTER TABLE public.bookings
ADD CONSTRAINT bookings_source_channel_check
CHECK (source_channel = ANY (ARRAY[
  'salonboard'::text,
  'rakuten_beauty'::text,
  'line_reservation'::text,
  'google_reservation'::text,
  'own_web'::text,
  'phone'::text,
  'manual'::text,
  'line'::text
]));