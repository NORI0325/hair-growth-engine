
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS description text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

-- 公開閲覧
DROP POLICY IF EXISTS "menu-images public read" ON storage.objects;
CREATE POLICY "menu-images public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

-- オーナーのみアップロード／更新／削除（自分のIDフォルダ配下）
DROP POLICY IF EXISTS "menu-images owner insert" ON storage.objects;
CREATE POLICY "menu-images owner insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'menu-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "menu-images owner update" ON storage.objects;
CREATE POLICY "menu-images owner update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'menu-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "menu-images owner delete" ON storage.objects;
CREATE POLICY "menu-images owner delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'menu-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
