INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('broadcast-media', 'broadcast-media', true, 104857600, ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/3gpp',
  'application/pdf', 'application/vnd.ms-powerpoint', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'
]) ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS broadcast_media_read ON storage.objects;
CREATE POLICY broadcast_media_read ON storage.objects FOR SELECT USING (bucket_id = 'broadcast-media');
DROP POLICY IF EXISTS broadcast_media_insert ON storage.objects;
CREATE POLICY broadcast_media_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'broadcast-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
    AND ('account-' || p.account_id::text) = (storage.foldername(name))[1] AND is_account_member(p.account_id, 'agent')));
DROP POLICY IF EXISTS broadcast_media_update ON storage.objects;
CREATE POLICY broadcast_media_update ON storage.objects FOR UPDATE USING (
  bucket_id = 'broadcast-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
    AND ('account-' || p.account_id::text) = (storage.foldername(name))[1] AND is_account_member(p.account_id, 'agent')));
DROP POLICY IF EXISTS broadcast_media_delete ON storage.objects;
CREATE POLICY broadcast_media_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'broadcast-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
    AND ('account-' || p.account_id::text) = (storage.foldername(name))[1] AND is_account_member(p.account_id, 'agent')));
