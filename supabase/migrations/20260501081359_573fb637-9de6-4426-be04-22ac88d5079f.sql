-- =========================================
-- Phase 2: 日曜日 (weekday=0) のスタッフ勤務枠を補完
-- =========================================
INSERT INTO public.staff_schedules (owner_id, staff_id, weekday, start_time, end_time, active)
SELECT s.owner_id, s.id, 0, '10:00'::time, '19:00'::time, false
FROM public.staff s
WHERE NOT EXISTS (
  SELECT 1 FROM public.staff_schedules ss
  WHERE ss.staff_id = s.id AND ss.weekday = 0
);

-- 初期化トリガーを0..6に修正（日曜はactive=falseで作成）
CREATE OR REPLACE FUNCTION public.create_default_staff_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d SMALLINT;
BEGIN
  FOR d IN 0..6 LOOP
    INSERT INTO public.staff_schedules (owner_id, staff_id, weekday, start_time, end_time, active)
    VALUES (NEW.owner_id, NEW.id, d, '10:00', '19:00', d <> 0);  -- 日曜は初期OFF
  END LOOP;
  RETURN NEW;
END;
$$;

-- =========================================
-- Phase 3: salon_hours テーブル（曜日別営業時間 / 定休日）
-- =========================================
CREATE TABLE IF NOT EXISTS public.salon_hours (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_time TIME NOT NULL DEFAULT '10:00',
  close_time TIME NOT NULL DEFAULT '19:00',
  closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, weekday)
);

ALTER TABLE public.salon_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner salon_hours all" ON public.salon_hours
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "public salon_hours read" ON public.salon_hours
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE TRIGGER trg_salon_hours_updated_at
  BEFORE UPDATE ON public.salon_hours
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_salon_hours_owner ON public.salon_hours(owner_id, weekday);

-- 既存のオーナー全員にデフォルト営業時間レコードを作成
-- profiles.open_time/close_timeを引き継ぎ、日曜は定休扱い
INSERT INTO public.salon_hours (owner_id, weekday, open_time, close_time, closed)
SELECT
  p.id,
  d.wd,
  COALESCE(p.open_time, '10:00'::time),
  COALESCE(p.close_time, '19:00'::time),
  d.wd = 0  -- 日曜は初期定休
FROM public.profiles p
CROSS JOIN (SELECT generate_series(0,6) AS wd) d
ON CONFLICT (owner_id, weekday) DO NOTHING;

-- 新規オーナーにも自動で7日分作成
CREATE OR REPLACE FUNCTION public.create_default_salon_hours()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d SMALLINT;
BEGIN
  FOR d IN 0..6 LOOP
    INSERT INTO public.salon_hours (owner_id, weekday, open_time, close_time, closed)
    VALUES (NEW.id, d, COALESCE(NEW.open_time, '10:00'::time), COALESCE(NEW.close_time, '19:00'::time), d = 0)
    ON CONFLICT (owner_id, weekday) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_default_salon_hours ON public.profiles;
CREATE TRIGGER trg_create_default_salon_hours
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_default_salon_hours();

-- =========================================
-- Phase 4: 空き枠RPCを営業時間 ∩ スタッフ勤務 に統合
-- =========================================
CREATE OR REPLACE FUNCTION public.get_available_slots_by_staff(
  _salon_slug text, _date date, _duration_minutes integer, _staff_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(slot_time time without time zone, available_staff_ids uuid[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _owner_id UUID;
  _open TIME;
  _close TIME;
  _closed BOOLEAN;
  _weekday SMALLINT;
  _duration INTERVAL;
  _lead_hours INTEGER;
  _earliest TIMESTAMPTZ;
BEGIN
  IF _duration_minutes IS NULL OR _duration_minutes < 15 THEN
    _duration_minutes := 60;
  END IF;
  _duration := (_duration_minutes || ' minutes')::INTERVAL;
  _weekday := EXTRACT(DOW FROM _date)::SMALLINT;

  -- 過去日チェック
  IF _date < CURRENT_DATE THEN RETURN; END IF;

  SELECT id, COALESCE(booking_lead_time_hours, 24)
    INTO _owner_id, _lead_hours
    FROM public.profiles WHERE public_slug = _salon_slug;

  IF _owner_id IS NULL THEN RETURN; END IF;

  -- 曜日別営業時間を取得（無ければprofilesにフォールバック）
  SELECT sh.open_time, sh.close_time, sh.closed
    INTO _open, _close, _closed
    FROM public.salon_hours sh
   WHERE sh.owner_id = _owner_id AND sh.weekday = _weekday;

  IF _open IS NULL THEN
    SELECT COALESCE(open_time, '10:00'::TIME), COALESCE(close_time, '19:00'::TIME), false
      INTO _open, _close, _closed
      FROM public.profiles WHERE id = _owner_id;
  END IF;

  -- 定休日なら空
  IF _closed THEN RETURN; END IF;

  _earliest := now() + (_lead_hours || ' hours')::INTERVAL;

  RETURN QUERY
  WITH slots AS (
    SELECT (_date + _open + (n || ' minutes')::INTERVAL)::TIMESTAMP AS slot_start
    FROM generate_series(0, EXTRACT(EPOCH FROM (_close - _open))::INTEGER / 60, 15) AS n
    WHERE (_date + _open + (n || ' minutes')::INTERVAL + _duration)::TIME <= _close
      AND (_date + _open + (n || ' minutes')::INTERVAL) AT TIME ZONE 'Asia/Tokyo' >= _earliest
  ),
  active_staff AS (
    SELECT s.id, ss.start_time, ss.end_time
    FROM public.staff s
    JOIN public.staff_schedules ss ON ss.staff_id = s.id
    WHERE s.owner_id = _owner_id
      AND s.active = true AND s.bookable = true
      AND ss.weekday = _weekday AND ss.active = true
      AND (_staff_id IS NULL OR s.id = _staff_id)
  ),
  availability AS (
    SELECT
      sl.slot_start::TIME AS t,
      COALESCE(array_agg(a.id) FILTER (
        WHERE
          sl.slot_start::TIME >= a.start_time
          AND (sl.slot_start + _duration)::TIME <= a.end_time
          AND NOT EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.staff_id = a.id
              AND b.booking_date = _date
              AND b.status IN ('pending', 'confirmed')
              AND tsrange(
                (_date + b.booking_time)::TIMESTAMP,
                (_date + b.booking_time + ((COALESCE(b.total_duration_minutes, 60)) || ' minutes')::INTERVAL)::TIMESTAMP
              ) && tsrange(sl.slot_start, sl.slot_start + _duration)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.staff_time_off t
            WHERE t.staff_id = a.id
              AND tstzrange(t.start_at, t.end_at) && tstzrange(
                (sl.slot_start AT TIME ZONE 'Asia/Tokyo'),
                ((sl.slot_start + _duration) AT TIME ZONE 'Asia/Tokyo')
              )
          )
      ), ARRAY[]::uuid[]) AS staff_ids
    FROM slots sl
    LEFT JOIN active_staff a ON true
    GROUP BY sl.slot_start
  )
  SELECT t, staff_ids FROM availability WHERE array_length(staff_ids, 1) > 0 ORDER BY t;
END;
$$;