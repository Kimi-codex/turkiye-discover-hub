-- Phase C: Production-safe enrichment pipeline.
-- Unified content-generation tracking table replaces ad-hoc business_seo.

-- 1. business_content_generation — tracks all AI-generated content (descriptions, SEO)
--    with prompt version, source fingerprint, generation key, retry state, and status.
CREATE TABLE IF NOT EXISTS public.business_content_generation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('description', 'seo')),
  locale TEXT NOT NULL CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  prompt_version TEXT NOT NULL,
  source_content_hash TEXT NOT NULL,
  generation_key TEXT NOT NULL UNIQUE,
  generation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (generation_status IN ('pending', 'processing', 'completed', 'failed', 'stale')),
  generated_content TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.business_content_generation ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_content_generation TO authenticated;
GRANT ALL ON public.business_content_generation TO service_role;

CREATE POLICY "admin manages content_generation"
  ON public.business_content_generation
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS bcg_business_idx ON public.business_content_generation(business_id);
CREATE INDEX IF NOT EXISTS bcg_gen_key_idx ON public.business_content_generation(generation_key);
CREATE INDEX IF NOT EXISTS bcg_status_idx ON public.business_content_generation(generation_status);

-- 2. business_seo is no longer needed — content_generation handles everything.
DROP TABLE IF EXISTS public.business_seo CASCADE;

-- 3. Insert 'enrich' into import_batches stage check.
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_stage_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_stage_check CHECK (
  stage = ANY (ARRAY[
    'upload','detect_schema','field_mapping','analyze','mapping','validation','preview','execute',
    'translations','enrich','images','publish','completed'
  ])
);
