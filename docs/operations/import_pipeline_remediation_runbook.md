# Import Pipeline Remediation Runbook

This runbook is intentionally conservative. Do not report the import pipeline as
fixed until the source JSON, database, and running UI all show matching evidence.

## Current constraints

- Cloudflare R2 remains deferred. Imported Google image references must be
  preserved for later R2 processing, but direct public rendering is only possible
  when a stable HTTP(S) `source_url` exists.
- The workspace currently contains only public Supabase credentials. Destructive
  cleanup SQL must not be generated or executed until the live schema/FK output
  from `00_schema_and_import_scope_inspection.sql` has been reviewed.
- `final.json` is not present in the workspace. Source-file verification must be
  run once the file is available.

## Verification order

1. Analyze the source JSON:

   ```bash
   npm run analyze:import-json -- path/to/final.json
   ```

   Record total businesses, image items, source references, direct URLs, review
   items, and capped importable reviews.

2. Run the read-only schema/import-scope inspection in Supabase SQL Editor:

   ```sql
   -- docs/operations/00_schema_and_import_scope_inspection.sql
   ```

   Save the output before preparing cleanup SQL.

3. Apply additive schema migrations only after normal migration review:

   - `20260722140500_add_business_image_source_fingerprint.sql`
   - `20260722143000_make_review_import_upsert_conflict_inferable.sql`

4. Prepare cleanup SQL only from verified live schema/FK output. The cleanup must
   target selected import batches or `businesses.source = 'google_json'` and must
   preserve users, roles, settings, base categories, category translations,
   cities, districts, and manually created businesses.

5. Re-run a small controlled import batch.

6. Verify database evidence:

   - imported businesses exist with expected `source = 'google_json'`
   - `business_images` rows exist for each preserved image/reference
   - `reviews` rows exist for up to 15 Google reviews per business
   - `business_category_links` rows exist for mapped categories
   - no import batch item reports false success after child-table failure

7. Verify running UI:

   - `/admin/imports/$id` shows the reprocess action
   - `/admin/images` shows imported image records and source references
   - public business pages show aggregate rating/review count and imported
     review excerpts after publishing
   - gallery displays stable `source_url` images when available and placeholders
     for reference-only rows until R2 is enabled

## Required success standard

Code existence is not evidence. Treat a feature as not implemented until it is
observed in the running app or verified in the database.
