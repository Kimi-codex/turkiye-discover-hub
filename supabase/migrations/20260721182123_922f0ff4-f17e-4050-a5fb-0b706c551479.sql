
-- Widen stage + status
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_stage_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_stage_check
  CHECK (stage = ANY (ARRAY[
    'upload','detect_schema','field_mapping','analyze','entity_mapping',
    'validation','preview','execute','translations','images',
    'post_import_review','publication','publish','completed'
  ]));

ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_status_check
  CHECK (status = ANY (ARRAY[
    'pending','uploaded','detecting','schema_detected','field_mapping_pending','field_mapping_approved',
    'analyzing','ready','mapping','entity_mapping_pending','entity_mapping_approved',
    'validating','validation_approved','previewing','previewed','awaiting_approval',
    'importing','post_import_review','publishing','publication_pending',
    'completed','partially_completed','failed','cancelled','archived'
  ]));

-- Hash bundle + inventory on batch
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS schema_hash text,
  ADD COLUMN IF NOT EXISTS field_mapping_hash text,
  ADD COLUMN IF NOT EXISTS entity_mapping_hash text,
  ADD COLUMN IF NOT EXISTS validation_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS publication_hash text,
  ADD COLUMN IF NOT EXISTS field_inventory jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_mappings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Per-item extensions
ALTER TABLE public.import_batch_items
  ADD COLUMN IF NOT EXISTS normalized_item_hash text,
  ADD COLUMN IF NOT EXISTS target_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS publication_decision text,
  ADD COLUMN IF NOT EXISTS publication_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS publication_decided_by uuid,
  ADD COLUMN IF NOT EXISTS image_states jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.import_batch_items DROP CONSTRAINT IF EXISTS ibi_publication_decision_check;
ALTER TABLE public.import_batch_items ADD CONSTRAINT ibi_publication_decision_check
  CHECK (publication_decision IS NULL OR publication_decision = ANY (ARRAY[
    'pending','publish','keep_draft','reject','accept_changes','keep_current'
  ]));

CREATE INDEX IF NOT EXISTS idx_ibi_publication_decision ON public.import_batch_items(publication_decision);

-- Approval ledger
CREATE TABLE IF NOT EXISTS public.import_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  approval_kind text NOT NULL,
  artifact_hash text NOT NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  invalidated_at timestamptz,
  invalidation_reason text,
  CONSTRAINT import_approvals_kind_check CHECK (approval_kind = ANY (ARRAY[
    'field_mapping','entity_mapping','validation','preview','publication'
  ]))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_approvals TO authenticated;
GRANT ALL ON public.import_approvals TO service_role;

ALTER TABLE public.import_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_approvals_admin_all ON public.import_approvals;
CREATE POLICY import_approvals_admin_all ON public.import_approvals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_import_approvals_batch ON public.import_approvals(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_approvals_kind ON public.import_approvals(batch_id, approval_kind)
  WHERE invalidated_at IS NULL;
