/**
 * Enrichment prompt versioning, source fingerprinting, and generation keys.
 * Independent from TRANSLATION_PROMPT_VERSION.
 */
import { sha256Hex } from "@/lib/utils/sha256";

export const ENRICHMENT_PROMPT_VERSION = "enrich-v1";

export type ContentType = "description" | "seo";

/**
 * Deterministic source hash built from the exact fields used in generation prompts.
 * Any change to these fields invalidates existing generated content.
 */
export function computeSourceHash(fields: {
  name: string;
  category: string;
  city: string;
  originalLanguage: string;
  existingDescription: string;
}): string {
  const canonical = {
    n: fields.name.trim().toLowerCase(),
    c: fields.category.trim().toLowerCase(),
    t: fields.city.trim().toLowerCase(),
    l: fields.originalLanguage.trim().toLowerCase(),
    d: fields.existingDescription.trim().toLowerCase(),
  };
  return sha256Hex(JSON.stringify(canonical));
}

/**
 * Deterministic generation key that uniquely identifies a generation job.
 * Encodes: business_id + content_type + locale + source_hash + prompt_version.
 *
 * If any input changes the key changes, so a previously completed record
 * with the same key is a guaranteed cache hit. A different key means
 * the content must be regenerated (source data or prompt changed).
 */
export function computeGenerationKey(params: {
  businessId: string;
  contentType: ContentType;
  locale: string;
  sourceHash: string;
  promptVersion: string;
}): string {
  const raw = [
    params.businessId,
    params.contentType,
    params.locale,
    params.sourceHash,
    params.promptVersion,
  ].join("|");
  return sha256Hex(raw);
}

/**
 * Check whether a generation record is still fresh.
 */
export function isGenerationFresh(params: {
  recordStatus: string;
  recordSourceHash: string;
  recordPromptVersion: string;
  currentSourceHash: string;
  currentPromptVersion: string;
}): boolean {
  if (params.recordStatus !== "completed") return false;
  if (params.recordSourceHash !== params.currentSourceHash) return false;
  if (params.recordPromptVersion !== params.currentPromptVersion) return false;
  return true;
}
