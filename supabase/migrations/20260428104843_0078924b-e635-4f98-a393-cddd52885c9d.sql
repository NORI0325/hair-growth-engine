
INSERT INTO storage.buckets (id, name, public) VALUES ('line-assets', 'line-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "line-assets public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'line-assets');

CREATE POLICY "line-assets owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'line-assets');

CREATE POLICY "line-assets owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'line-assets');

CREATE POLICY "line-assets owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'line-assets');
