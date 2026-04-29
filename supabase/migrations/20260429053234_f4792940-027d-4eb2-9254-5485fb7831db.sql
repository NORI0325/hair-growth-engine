-- スタッフテーブル
CREATE TABLE public.staff (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  display_color TEXT NOT NULL DEFAULT '#C9A961',
  bookable BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner staff all" ON public.staff
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- 公開予約ページで参照（active のみ）
CREATE POLICY "public staff read" ON public.staff
  FOR SELECT TO anon, authenticated
  USING (active = true AND bookable = true);

CREATE INDEX idx_staff_owner ON public.staff(owner_id);

CREATE TRIGGER staff_updated_at
  BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- スタッフ勤務時間（曜日 0=日 〜 6=土）
CREATE TABLE public.staff_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL DEFAULT '10:00',
  end_time TIME NOT NULL DEFAULT '19:00',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner staff_schedules all" ON public.staff_schedules
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "public staff_schedules read" ON public.staff_schedules
  FOR SELECT TO anon, authenticated
  USING (active = true);

CREATE INDEX idx_staff_schedules_staff ON public.staff_schedules(staff_id, weekday);

CREATE TRIGGER staff_schedules_updated_at
  BEFORE UPDATE ON public.staff_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- スタッフの休暇・休憩（特定日時ブロック）
CREATE TABLE public.staff_time_off (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  start_at TIMESTAMP WITH TIME ZONE NOT NULL,
  end_at TIMESTAMP WITH TIME ZONE NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_time_off ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner staff_time_off all" ON public.staff_time_off
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX idx_staff_time_off_staff ON public.staff_time_off(staff_id, start_at, end_at);

-- bookingsに担当スタッフを追加
ALTER TABLE public.bookings
  ADD COLUMN staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE INDEX idx_bookings_staff_date ON public.bookings(staff_id, booking_date, booking_time)
  WHERE staff_id IS NOT NULL;

-- スタッフ作成時にデフォルト勤務時間（月〜土 10:00-19:00）を自動登録
CREATE OR REPLACE FUNCTION public.create_default_staff_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d SMALLINT;
BEGIN
  FOR d IN 1..6 LOOP
    INSERT INTO public.staff_schedules (owner_id, staff_id, weekday, start_time, end_time)
    VALUES (NEW.owner_id, NEW.id, d, '10:00', '19:00');
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_default_schedule
  AFTER INSERT ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.create_default_staff_schedule();

-- 空き枠計算用のRPC: 指定日のスタッフ別空き時間を返す
CREATE OR REPLACE FUNCTION public.get_available_slots(
  _salon_slug TEXT,
  _date DATE,
  _duration_minutes INTEGER
)
RETURNS TABLE(slot_time TIME, available_staff_count INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_id UUID;
  _open TIME;
  _close TIME;
  _weekday SMALLINT;
  _slot_interval INTERVAL := '15 minutes';
  _duration INTERVAL;
BEGIN
  IF _duration_minutes IS NULL OR _duration_minutes < 15 THEN
    _duration_minutes := 60;
  END IF;
  _duration := (_duration_minutes || ' minutes')::INTERVAL;
  _weekday := EXTRACT(DOW FROM _date)::SMALLINT;

  SELECT id, COALESCE(open_time, '10:00'::TIME), COALESCE(close_time, '19:00'::TIME)
    INTO _owner_id, _open, _close
    FROM public.profiles WHERE public_slug = _salon_slug;

  IF _owner_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH slots AS (
    SELECT (_date + _open + (n || ' minutes')::INTERVAL)::TIMESTAMP AS slot_start
    FROM generate_series(0, EXTRACT(EPOCH FROM (_close - _open))::INTEGER / 60, 15) AS n
    WHERE (_date + _open + (n || ' minutes')::INTERVAL + _duration)::TIME <= _close
  ),
  active_staff AS (
    SELECT s.id, ss.start_time, ss.end_time
    FROM public.staff s
    JOIN public.staff_schedules ss ON ss.staff_id = s.id
    WHERE s.owner_id = _owner_id
      AND s.active = true AND s.bookable = true
      AND ss.weekday = _weekday AND ss.active = true
  ),
  availability AS (
    SELECT
      sl.slot_start::TIME AS t,
      COUNT(DISTINCT a.id) FILTER (
        WHERE
          sl.slot_start::TIME >= a.start_time
          AND (sl.slot_start + _duration)::TIME <= a.end_time
          -- 既存予約と被らない
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
          -- 休暇と被らない
          AND NOT EXISTS (
            SELECT 1 FROM public.staff_time_off t
            WHERE t.staff_id = a.id
              AND tstzrange(t.start_at, t.end_at) && tstzrange(
                (sl.slot_start AT TIME ZONE 'Asia/Tokyo'),
                ((sl.slot_start + _duration) AT TIME ZONE 'Asia/Tokyo')
              )
          )
      )::INTEGER AS cnt
    FROM slots sl
    LEFT JOIN active_staff a ON true
    GROUP BY sl.slot_start
  )
  SELECT t, cnt FROM availability WHERE cnt > 0 ORDER BY t;
END;
$$;