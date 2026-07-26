-- Phase D: Search architecture — extensions and text search configuration.
-- Additive and idempotent. Safe to run at any time.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Custom accent-insensitive text search config using simple dictionary.
CREATE TEXT SEARCH CONFIGURATION IF NOT EXISTS public.simple_unaccent (COPY = pg_catalog.simple);
ALTER TEXT SEARCH CONFIGURATION public.simple_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH extensions.unaccent, pg_catalog.simple;
