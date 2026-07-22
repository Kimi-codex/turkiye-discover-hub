-- Preserve imported image source references idempotently.
-- Google image inputs are not always stable public URLs; some exports provide
-- photo_reference/name values that must be stored for later R2 processing.

ALTER TABLE public.business_images
  ADD COLUMN IF NOT EXISTS source_fingerprint text;

UPDATE public.business_images
SET source_fingerprint = md5(
  concat_ws(
    '|',
    source_provider,
    source_type,
    place_id,
    coalesce(source_url, ''),
    coalesce(source_metadata::text, '')
  )
)
WHERE source_fingerprint IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_images_source_fingerprint
  ON public.business_images (business_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL AND deleted_at IS NULL;

-- PostgREST upsert conflict inference cannot target the partial index above
-- through `onConflict=business_id,source_fingerprint`. Keep the partial index
-- for active-row lookup performance, and add a non-partial unique arbiter for
-- idempotent imports. Multiple NULL fingerprints are still allowed by Postgres,
-- while normalized Google imports always provide a non-NULL fingerprint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_images_source_fingerprint_all
  ON public.business_images (business_id, source_fingerprint);
