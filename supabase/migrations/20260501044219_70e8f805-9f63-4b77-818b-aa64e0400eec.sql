
CREATE OR REPLACE FUNCTION public.create_holiday_notice_jobs(
  _notice_title TEXT,
  _notice_body  TEXT,
  _start_date   TEXT DEFAULT NULL,
  _end_date     TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _owner_id UUID := auth.uid();
  _count INTEGER := 0;
BEGIN
  IF _owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  IF _notice_title IS NULL OR length(trim(_notice_title)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'title_required');
  END IF;

  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT
    _owner_id, c.id, 'holiday_notice',
    GREATEST(now() + INTERVAL '5 minutes', ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo')),
    jsonb_build_object(
      'noticeTitle', _notice_title,
      'noticeBody', _notice_body,
      'startDate', _start_date,
      'endDate', _end_date
    )
  FROM public.customers c
  WHERE c.owner_id = _owner_id
    AND COALESCE(c.is_test, false) = false
    AND (c.email IS NOT NULL OR c.phone IS NOT NULL OR c.line_user_id IS NOT NULL);
  GET DIAGNOSTICS _count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'queued', _count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_holiday_notice_jobs(TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_holiday_notice_jobs(TEXT, TEXT, TEXT, TEXT) TO authenticated;
