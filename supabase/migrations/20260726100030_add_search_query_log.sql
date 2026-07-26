-- Phase D: Search query log for telemetry and analytics.
-- Additive and idempotent. Safe to run at any time.

CREATE TABLE IF NOT EXISTS public.search_query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  locale TEXT NOT NULL,
  intent JSONB,
  result_count INTEGER,
  top_result_ids UUID[],
  duration_ms INTEGER,
  method TEXT, -- 'fulltext' | 'trigram_fallback' | 'browse'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_query_log_created_idx
  ON public.search_query_log (created_at DESC);

GRANT INSERT ON public.search_query_log TO anon, authenticated;
