
-- 1. Widen import_batches.status check list.
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_status_check CHECK (
  status = ANY (ARRAY[
    'pending','uploaded','analyzing','ready','mapping','previewing','previewed',
    'awaiting_approval','importing','publishing','completed','partially_completed',
    'failed','cancelled','archived'
  ])
);

-- 2. New columns on import_batches.
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS preview_hash text,
  ADD COLUMN IF NOT EXISTS previewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS mapping_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz;

ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_stage_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_stage_check CHECK (
  stage = ANY (ARRAY[
    'upload','analyze','mapping','validation','preview','execute',
    'translations','images','publish','completed'
  ])
);

-- 3. Three-state fields on import_batch_items.
ALTER TABLE public.import_batch_items
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS current_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS proposed_diff jsonb,
  ADD COLUMN IF NOT EXISTS approved_fields text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS preview_hash text;

ALTER TABLE public.import_batch_items DROP CONSTRAINT IF EXISTS import_batch_items_intent_check;
ALTER TABLE public.import_batch_items ADD CONSTRAINT import_batch_items_intent_check CHECK (
  intent IS NULL OR intent = ANY (ARRAY['insert','update','noop','invalid','needs_mapping'])
);

-- 4. Provenance table.
CREATE TABLE IF NOT EXISTS public.business_import_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  import_batch_item_id uuid REFERENCES public.import_batch_items(id) ON DELETE SET NULL,
  applied_action text NOT NULL,
  applied_fields text[] NOT NULL DEFAULT '{}'::text[],
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bip_action_check CHECK (applied_action = ANY (ARRAY['insert','update','noop']))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_import_provenance TO authenticated;
GRANT ALL ON public.business_import_provenance TO service_role;
ALTER TABLE public.business_import_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manages provenance"
  ON public.business_import_provenance
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS bip_business_idx ON public.business_import_provenance(business_id);
CREATE INDEX IF NOT EXISTS bip_batch_idx ON public.business_import_provenance(import_batch_id);
