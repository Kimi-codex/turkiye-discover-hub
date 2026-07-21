
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS detected_schema jsonb,
  ADD COLUMN IF NOT EXISTS field_mapping jsonb,
  ADD COLUMN IF NOT EXISTS schema_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS field_mapping_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS field_mapping_approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_import_approvals_batch_kind_active
  ON public.import_approvals (batch_id, approval_kind)
  WHERE invalidated_at IS NULL;
