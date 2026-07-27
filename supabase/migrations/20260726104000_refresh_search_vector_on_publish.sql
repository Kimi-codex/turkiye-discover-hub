-- Phase E remediation: refresh full category/alias-aware search vectors when a
-- business publication state changes.
--
-- The preceding Phase E migration already adds an AFTER INSERT/UPDATE trigger
-- for fields that affect vector content. This additive migration widens that
-- trigger to include status updates so a draft inserted with a basic BEFORE
-- vector receives the complete published vector when it is later published.

DROP TRIGGER IF EXISTS trg_businesses_search_vector_after_write ON public.businesses;
CREATE TRIGGER trg_businesses_search_vector_after_write
  AFTER INSERT OR UPDATE OF name, slug, description, primary_category_id, status ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.refresh_business_search_vector_after_write();
