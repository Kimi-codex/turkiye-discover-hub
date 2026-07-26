-- Phase D: Search vector, platform rating columns, ranking score.
-- Additive and idempotent. Safe to run at any time.

-- Add columns for full-text search vector and blended ranking
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS platform_avg_rating numeric(2,1);
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS platform_review_count INTEGER DEFAULT 0;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS ranking_score numeric(4,3);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS businesses_search_vector_idx
  ON public.businesses USING GIN (search_vector);

-- B-tree index for blended ranking sort
CREATE INDEX IF NOT EXISTS businesses_published_ranking_score_idx
  ON public.businesses (ranking_score DESC NULLS LAST)
  WHERE status = 'published';

-- ── search_vector maintenance ──

CREATE OR REPLACE FUNCTION public.rebuild_search_vectors() RETURNS void
  LANGUAGE sql AS
$$
  UPDATE public.businesses SET
    search_vector =
      setweight(to_tsvector('public.simple_unaccent', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('public.simple_unaccent', coalesce(slug, '')), 'A')
  WHERE status = 'published';
$$;

CREATE OR REPLACE FUNCTION public.maintain_search_vector() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.slug, '')), 'A');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_businesses_search_vector ON public.businesses;
CREATE TRIGGER trg_businesses_search_vector
  BEFORE INSERT OR UPDATE OF name, slug ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.maintain_search_vector();

-- ── ranking_score maintenance ──

CREATE OR REPLACE FUNCTION public.rebuild_ranking_scores() RETURNS void
  LANGUAGE plpgsql AS
$$
BEGIN
  -- Compute platform review stats
  UPDATE public.businesses SET
    platform_avg_rating = COALESCE((
      SELECT AVG(r.rating)::numeric(2,1)
      FROM public.reviews r
      WHERE r.business_id = businesses.id
        AND r.status = 'published'
        AND r.source = 'platform'
    ), 0),
    platform_review_count = COALESCE((
      SELECT COUNT(*)::integer
      FROM public.reviews r
      WHERE r.business_id = businesses.id
        AND r.status = 'published'
        AND r.source = 'platform'
    ), 0);

  -- Compute blended ranking score
  UPDATE public.businesses SET
    ranking_score = (
      -- Imported Bayesian component (uses imported rating, review_count)
      ((COALESCE(rating, 0) * COALESCE(review_count, 0) + 10.5)
        / (COALESCE(review_count, 0) + 3.0))
      * (1.0 - LEAST(1.0, COALESCE(platform_review_count, 0)::numeric / 10.0))
      +
      -- Platform Bayesian component
      ((COALESCE(platform_avg_rating, 0) * COALESCE(platform_review_count, 0) + 10.5)
        / (COALESCE(platform_review_count, 0) + 3.0))
      * LEAST(1.0, COALESCE(platform_review_count, 0)::numeric / 10.0)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.maintain_business_ranking() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  target_id UUID;
  pr_avg numeric(2,1);
  pr_count integer;
BEGIN
  target_id := COALESCE(NEW.business_id, OLD.business_id);

  SELECT AVG(r.rating)::numeric(2,1), COUNT(*)::integer
  INTO pr_avg, pr_count
  FROM public.reviews r
  WHERE r.business_id = target_id
    AND r.status = 'published'
    AND r.source = 'platform';

  UPDATE public.businesses SET
    platform_avg_rating = COALESCE(pr_avg, 0),
    platform_review_count = COALESCE(pr_count, 0),
    ranking_score = (
      ((COALESCE(rating, 0) * COALESCE(review_count, 0) + 10.5)
        / (COALESCE(review_count, 0) + 3.0))
      * (1.0 - LEAST(1.0, COALESCE(pr_count, 0)::numeric / 10.0))
      +
      ((COALESCE(pr_avg, 0) * COALESCE(pr_count, 0) + 10.5)
        / (COALESCE(pr_count, 0) + 3.0))
      * LEAST(1.0, COALESCE(pr_count, 0)::numeric / 10.0)
    )
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_business_ranking ON public.reviews;
CREATE TRIGGER trg_reviews_business_ranking
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.maintain_business_ranking();
