-- Make Google review import upserts inferable through PostgREST's
-- onConflict=business_id,source,source_fingerprint argument.
--
-- The earlier partial index remains useful for source_fingerprint IS NOT NULL
-- lookups, but a non-partial unique index is required as an ON CONFLICT arbiter.
-- Postgres unique indexes allow multiple NULL source_fingerprint values, while
-- normalized Google imports always provide a non-NULL source_fingerprint.

CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_source_fingerprint_all
  ON public.reviews (business_id, source, source_fingerprint);
