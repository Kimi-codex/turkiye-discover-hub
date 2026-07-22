/**
 * Deterministic hashing for the translation cache.
 *
 * Cache key domain (all included in the hash):
 *   - normalized source text (trim + NFC + collapse whitespace)
 *   - source language
 *   - target language
 *   - source field name  (e.g. "description")
 *   - prompt version     (bumped when prompt/model contract changes)
 *
 * Two calls with the exact same inputs must always produce the same hash so
 * we can look up business_translations.source_content_hash and reuse the
 * stored translation without calling the provider.
 */
import { sha256Hex } from "@/lib/utils/sha256";

/** Bump when the prompt contract or provider expectations change. */
export const TRANSLATION_PROMPT_VERSION = "v1";

export function normalizeSourceText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface HashInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  field: string;
  promptVersion?: string;
}

export function computeSourceHash(input: HashInput): string {
  const normalized = normalizeSourceText(input.text);
  const payload = [
    normalized,
    input.sourceLanguage,
    input.targetLanguage,
    input.field,
    input.promptVersion ?? TRANSLATION_PROMPT_VERSION,
  ].join("\u0001");
  return sha256Hex(payload);
}
