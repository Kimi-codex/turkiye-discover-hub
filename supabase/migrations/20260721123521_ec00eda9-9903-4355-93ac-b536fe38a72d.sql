
-- Admins can do everything on objects inside the private 'imports' bucket
CREATE POLICY "imports_admin_all_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'imports' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "imports_admin_all_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imports' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "imports_admin_all_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'imports' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'imports' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "imports_admin_all_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'imports' AND public.has_role(auth.uid(), 'admin'));
