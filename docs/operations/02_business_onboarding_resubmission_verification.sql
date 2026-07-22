-- Semantic verification for:
-- supabase/migrations/20260722201000_allow_additional_document_resubmission.sql
--
-- Run after applying the migration. These checks validate the actual status
-- set admitted by applicant-facing policies/functions, instead of searching
-- for status names as loose substrings.

WITH expected(status) AS (
  VALUES
    ('draft'),
    ('changes_requested'),
    ('additional_documents_required')
),
policy_sources AS (
  SELECT
    policyname,
    coalesce(qual, '') || ' ' || coalesce(with_check, '') AS definition
  FROM pg_policies
  WHERE (schemaname, tablename, policyname) IN (
    ('public', 'business_onboarding_submissions', 'bos_applicant_update'),
    ('public', 'business_onboarding_documents', 'bod_applicant_insert'),
    ('public', 'business_onboarding_images', 'boi_applicant_insert'),
    ('storage', 'objects', 'business_verification_documents_applicant_insert'),
    ('storage', 'objects', 'business_onboarding_images_applicant_insert')
  )
),
allowed_by_policy AS (
  SELECT DISTINCT
    ps.policyname,
    (m.match)[1] AS status
  FROM policy_sources ps
  CROSS JOIN LATERAL regexp_matches(
    ps.definition,
    $$'((?:draft)|(?:changes_requested)|(?:additional_documents_required)|(?:submitted)|(?:under_review)|(?:approved)|(?:rejected)|(?:withdrawn)|(?:duplicate)|(?:linked))'$$,
    'g'
  ) AS m(match)
),
missing_expected AS (
  SELECT ps.policyname, e.status
  FROM policy_sources ps
  CROSS JOIN expected e
  EXCEPT
  SELECT policyname, status FROM allowed_by_policy
),
unexpected_allowed AS (
  SELECT policyname, status FROM allowed_by_policy
  EXCEPT
  SELECT ps.policyname, e.status
  FROM policy_sources ps
  CROSS JOIN expected e
)
SELECT
  jsonb_object_agg(policyname, statuses ORDER BY policyname) AS policy_allowed_statuses,
  coalesce(jsonb_agg(DISTINCT missing_expected) FILTER (WHERE missing_expected.policyname IS NOT NULL), '[]'::jsonb) AS missing_expected_statuses,
  coalesce(jsonb_agg(DISTINCT unexpected_allowed) FILTER (WHERE unexpected_allowed.policyname IS NOT NULL), '[]'::jsonb) AS unexpected_allowed_statuses,
  NOT EXISTS (SELECT 1 FROM missing_expected)
    AND NOT EXISTS (SELECT 1 FROM unexpected_allowed) AS applicant_policies_allow_exact_editable_status_set
FROM (
  SELECT policyname, array_agg(status ORDER BY status) AS statuses
  FROM allowed_by_policy
  GROUP BY policyname
) grouped
LEFT JOIN missing_expected USING (policyname)
LEFT JOIN unexpected_allowed USING (policyname);

WITH expected(status) AS (
  VALUES
    ('draft'),
    ('changes_requested'),
    ('additional_documents_required')
),
function_sources AS (
  SELECT
    p.proname,
    pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'submit_business_onboarding_submission',
      'prepare_business_onboarding_document_replacement',
      'remove_business_onboarding_document',
      'remove_business_onboarding_image'
    )
),
editable_guards AS (
  SELECT
    proname,
    substring(
      definition FROM
      $$status\s+NOT\s+IN\s+\(([^)]*)\)$$
    ) AS guard
  FROM function_sources
),
allowed_by_function AS (
  SELECT DISTINCT
    eg.proname,
    (m.match)[1] AS status
  FROM editable_guards eg
  CROSS JOIN LATERAL regexp_matches(
    coalesce(eg.guard, ''),
    $$'((?:draft)|(?:changes_requested)|(?:additional_documents_required)|(?:submitted)|(?:under_review)|(?:approved)|(?:rejected)|(?:withdrawn)|(?:duplicate)|(?:linked))'$$,
    'g'
  ) AS m(match)
),
missing_expected AS (
  SELECT eg.proname, e.status
  FROM editable_guards eg
  CROSS JOIN expected e
  EXCEPT
  SELECT proname, status FROM allowed_by_function
),
unexpected_allowed AS (
  SELECT proname, status FROM allowed_by_function
  EXCEPT
  SELECT eg.proname, e.status
  FROM editable_guards eg
  CROSS JOIN expected e
),
missing_guards AS (
  SELECT proname
  FROM editable_guards
  WHERE guard IS NULL
)
SELECT
  array(SELECT proname FROM missing_guards ORDER BY proname) AS functions_missing_editable_guard,
  jsonb_object_agg(proname, statuses ORDER BY proname) AS function_allowed_statuses,
  coalesce(jsonb_agg(DISTINCT missing_expected) FILTER (WHERE missing_expected.proname IS NOT NULL), '[]'::jsonb) AS missing_expected_statuses,
  coalesce(jsonb_agg(DISTINCT unexpected_allowed) FILTER (WHERE unexpected_allowed.proname IS NOT NULL), '[]'::jsonb) AS unexpected_allowed_statuses,
  NOT EXISTS (SELECT 1 FROM missing_guards)
    AND NOT EXISTS (SELECT 1 FROM missing_expected)
    AND NOT EXISTS (SELECT 1 FROM unexpected_allowed) AS rpc_guards_allow_exact_editable_status_set
FROM (
  SELECT proname, array_agg(status ORDER BY status) AS statuses
  FROM allowed_by_function
  GROUP BY proname
) grouped
LEFT JOIN missing_expected USING (proname)
LEFT JOIN unexpected_allowed USING (proname);
