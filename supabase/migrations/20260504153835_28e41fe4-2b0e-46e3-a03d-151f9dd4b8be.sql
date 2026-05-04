DELETE FROM public.location_members
WHERE user_id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb'
  AND location_id IN (
    SELECT id FROM public.locations WHERE tenant_id = 'bacec668-c498-482d-bb40-66599cc9bf9f'
  );