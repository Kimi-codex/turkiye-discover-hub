/**
 * Translation service — server-only.
 *
 * The caller (a `createServerFn` handler) verifies the admin role before
 * invoking anything here; this module uses `supabaseAdmin` to manage the
 * queue and the cache table.
 *
 * Cache = `business_translations` rows keyed by (business_id, language_code)
 * with `source_content_hash` marking which source-text version they came
 * from. Rerunning against the same source text is a no-op (cache hit).
 * Human-approved rows (`translation_status='approved'`) are NEVER
 * overwritten by machine output.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeSourceHash } from "./hash";
import { detectLanguage } from "./detect";
import { translateWithLovableAI } from "./lovable-provider.server";
import {
  SUPPORTED_LOCALES,
  TRANSLATABLE_FIELDS,
  type SupportedLocale,
  type TranslatableField,
} from "./provider";

const TRANSLATION_COLUMN = {
  name: "translated_name",
  description: "translated_description",
} as const satisfies Record<TranslatableField, "translated_name" | "translated_description">;

const SOURCE_COLUMN = {
  name: "name",
  description: "description",
} as const satisfies Record<TranslatableField, "name" | "description">;

interface BusinessRow {
  id: string;
  name: string | null;
  description: string | null;
}

/**
 * Enqueue jobs for every (target_language × field) missing for this business.
 * Duplicates are absorbed by the partial unique index on active statuses.
 */
export async function enqueueMissingTranslations(businessId: string): Promise<{
  enqueued: number;
  skipped: number;
}> {
  const { data: biz, error } = await supabaseAdmin
    .from("businesses")
    .select("id, name, description")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw error;
  if (!biz) return { enqueued: 0, skipped: 0 };
  const business = biz as BusinessRow;

  let enqueued = 0;
  let skipped = 0;

  for (const field of TRANSLATABLE_FIELDS) {
    const src = business[SOURCE_COLUMN[field]];
    if (!src || !src.trim()) {
      skipped++;
      continue;
    }
    const sourceLanguage = detectLanguage(src);
    for (const target of SUPPORTED_LOCALES) {
      if (target === sourceLanguage) {
        skipped++;
        continue;
      }
      const hash = computeSourceHash({
        text: src,
        sourceLanguage,
        targetLanguage: target,
        field,
      });
      const { error: insErr } = await supabaseAdmin.from("translation_jobs").insert({
        business_id: businessId,
        target_language: target,
        source_field: field,
        source_language: sourceLanguage,
        source_content_hash: hash,
        status: "pending",
      });
      if (insErr && !/duplicate|unique/i.test(insErr.message)) throw insErr;
      if (insErr) skipped++;
      else enqueued++;
    }
  }
  return { enqueued, skipped };
}

interface JobRow {
  id: string;
  business_id: string;
  target_language: string;
  source_field: string;
  source_language: string | null;
  source_content_hash: string | null;
  attempts: number;
  status: string;
}

/**
 * Process up to `limit` pending jobs. Atomic claim via
 * UPDATE ... WHERE status='pending' RETURNING.
 */
export async function runPendingJobs(limit = 5): Promise<
  Array<{ jobId: string; status: "completed" | "failed" | "cached"; error?: string }>
> {
  const { data: candidates, error: pickErr } = await supabaseAdmin
    .from("translation_jobs")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (pickErr) throw pickErr;
  const ids = (candidates ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return [];

  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("translation_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      attempts: 1,
    })
    .in("id", ids)
    .eq("status", "pending")
    .select(
      "id, business_id, target_language, source_field, source_language, source_content_hash, attempts, status",
    );
  if (claimErr) throw claimErr;

  const results: Array<{ jobId: string; status: "completed" | "failed" | "cached"; error?: string }> = [];
  for (const job of (claimed ?? []) as JobRow[]) {
    try {
      const outcome = await processJob(job);
      results.push({ jobId: job.id, status: outcome });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("translation_jobs")
        .update({ status: "failed", last_error: msg })
        .eq("id", job.id);
      results.push({ jobId: job.id, status: "failed", error: msg });
    }
  }
  return results;
}

async function processJob(job: JobRow): Promise<"completed" | "cached"> {
  const field = job.source_field as TranslatableField;
  if (!TRANSLATABLE_FIELDS.includes(field)) throw new Error(`unsupported_field:${field}`);
  const target = job.target_language as SupportedLocale;
  if (!SUPPORTED_LOCALES.includes(target)) throw new Error(`unsupported_target:${target}`);

  const srcCol = SOURCE_COLUMN[field];
  const trCol = TRANSLATION_COLUMN[field];

  const { data: biz, error: bErr } = await supabaseAdmin
    .from("businesses")
    .select(`id, ${srcCol}`)
    .eq("id", job.business_id)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!biz) {
    await supabaseAdmin
      .from("translation_jobs")
      .update({ status: "cancelled", last_error: "business_missing" })
      .eq("id", job.id);
    throw new Error("business_missing");
  }
  const sourceText = (biz as unknown as Record<string, string | null>)[srcCol];
  if (!sourceText || !sourceText.trim()) {
    await supabaseAdmin
      .from("translation_jobs")
      .update({ status: "cancelled", last_error: "source_empty" })
      .eq("id", job.id);
    throw new Error("source_empty");
  }

  const sourceLanguage = (job.source_language as SupportedLocale) ?? detectLanguage(sourceText);
  const hash = computeSourceHash({
    text: sourceText,
    sourceLanguage,
    targetLanguage: target,
    field,
  });

  const { data: cached } = await supabaseAdmin
    .from("business_translations")
    .select("id, translated_name, translated_description, source_content_hash, translation_status")
    .eq("business_id", job.business_id)
    .eq("language_code", target)
    .maybeSingle();

  const cachedRow = cached as
    | {
        source_content_hash: string | null;
        translation_status: string | null;
        translated_name: string | null;
        translated_description: string | null;
      }
    | null;

  const fieldValue = cachedRow ? cachedRow[trCol] : null;
  if (cachedRow && cachedRow.source_content_hash === hash && fieldValue) {
    await supabaseAdmin
      .from("translation_jobs")
      .update({ status: "completed", last_error: null, source_content_hash: hash })
      .eq("id", job.id);
    return "cached";
  }

  const isApproved = cachedRow?.translation_status === "approved";

  const result = await translateWithLovableAI({
    text: sourceText,
    sourceLanguage,
    targetLanguage: target,
    field,
  });

  const upsertRow: {
    business_id: string;
    language_code: string;
    source_content_hash: string;
    translated_by: string;
    updated_at: string;
    translated_name?: string;
    translated_description?: string;
    translation_status?: string;
  } = {
    business_id: job.business_id,
    language_code: target,
    source_content_hash: hash,
    translated_by: `machine:${result.provider}`,
    updated_at: new Date().toISOString(),
  };
  if (trCol === "translated_name") upsertRow.translated_name = result.translatedText;
  else upsertRow.translated_description = result.translatedText;
  if (!isApproved) upsertRow.translation_status = "machine";

  const { error: upErr } = await supabaseAdmin
    .from("business_translations")
    .upsert(upsertRow, { onConflict: "business_id,language_code" });
  if (upErr) throw upErr;

  await supabaseAdmin
    .from("translation_jobs")
    .update({
      status: "completed",
      last_error: null,
      model: result.model,
      source_content_hash: hash,
    })
    .eq("id", job.id);

  return "completed";
}

export async function getTranslationStatus() {
  const { data: rows, error } = await supabaseAdmin
    .from("translation_jobs")
    .select("status");
  if (error) throw error;
  const counts: Record<string, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  };
  for (const r of rows ?? []) {
    const s = (r as { status: string }).status;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const { count: translations } = await supabaseAdmin
    .from("business_translations")
    .select("id", { count: "exact", head: true });
  return {
    jobs: counts,
    totalTranslations: translations ?? 0,
    providerConfigured: !!process.env.LOVABLE_API_KEY,
  };
}

export async function listRecentJobs(limit = 100) {
  const { data, error } = await supabaseAdmin
    .from("translation_jobs")
    .select(
      "id, business_id, target_language, source_field, source_language, status, attempts, last_error, model, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Enqueue for every business row missing a translation for any (locale × field).
 * Bounded to `limit` businesses per call so admins can iterate safely.
 */
export async function enqueueForAllBusinesses(limit = 500): Promise<{
  scanned: number;
  totalEnqueued: number;
}> {
  const { data: rows, error } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .neq("status", "deleted")
    .limit(limit);
  if (error) throw error;
  let total = 0;
  for (const r of rows ?? []) {
    const res = await enqueueMissingTranslations((r as { id: string }).id);
    total += res.enqueued;
  }
  return { scanned: (rows ?? []).length, totalEnqueued: total };
}
