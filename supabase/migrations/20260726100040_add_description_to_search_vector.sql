-- E.3.1: Add description to search_vector with C-weight
-- Update the trigger function and backfill function to include description text.
-- This is additive: the existing GIN index still works since tsvector contents
-- can be updated without index rebuild.

-- ── 1. Update the trigger function ──────────────────────────
CREATE OR REPLACE FUNCTION public.maintain_search_vector() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.slug, '')), 'A') ||
    setweight(to_tsvector('public.simple_unaccent', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$;

-- ── 2. Update the backfill function ─────────────────────────
CREATE OR REPLACE FUNCTION public.rebuild_search_vectors() RETURNS void
  LANGUAGE sql AS
$$
  UPDATE public.businesses SET
    search_vector =
      setweight(to_tsvector('public.simple_unaccent', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('public.simple_unaccent', coalesce(slug, '')), 'A') ||
      setweight(to_tsvector('public.simple_unaccent', coalesce(description, '')), 'C')
  WHERE status = 'published';
$$;

-- ── 3. Update trigger to fire on description changes too ─────
DROP TRIGGER IF EXISTS trg_businesses_search_vector ON public.businesses;
CREATE TRIGGER trg_businesses_search_vector
  BEFORE INSERT OR UPDATE OF name, slug, description ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.maintain_search_vector();

-- ── 4. Backfill existing published businesses ────────────────
-- Existing rows are not backfilled automatically during deployment. Use the
-- bounded Phase E backfill function after deployment instead.

-- ── Rollback ─────────────────────────────────────────────────
-- To rollback:
--   1. Restore maintain_search_vector() to exclude description
--   2. Restore rebuild_search_vectors() to exclude description
--   3. Rebuild trigger on name, slug only
--   4. Run rebuild_search_vectors() only in a controlled maintenance window,
--      or use the bounded Phase E backfill function.
-- See 20260726100020_add_search_vector_and_ranking.sql for the original definitions.
