-- Additive: grant authenticated access on import pipeline tables so admin RLS policies can be evaluated by the Data API.
-- RLS remains admin-only via the existing "import_batches_admin_all" / "ibi_admin_all" policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batch_items TO authenticated;