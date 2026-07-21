ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_stage_check;

ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_stage_check
  CHECK (stage = ANY (ARRAY[
    'upload',
    'detect_schema',
    'field_mapping',
    'analyze',
    'mapping',
    'entity_mapping',
    'validation',
    'preview',
    'execute',
    'translations',
    'images',
    'post_import_review',
    'publication',
    'publish',
    'completed'
  ]));