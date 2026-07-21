/**
 * Client-safe types + constants for the translation pipeline.
 * NO provider calls, NO secrets — see `service.server.ts` for the runtime.
 */
export type SupportedLocale = "tr" | "en" | "ar";
export const SUPPORTED_LOCALES: SupportedLocale[] = ["tr", "en", "ar"];

/**
 * Fields eligible for automatic translation. Everything else (place_id, URLs,
 * phone numbers, coordinates, slugs, structured IDs, raw JSON, review text)
 * is NEVER translated.
 */
export type TranslatableField = "name" | "description";
export const TRANSLATABLE_FIELDS: TranslatableField[] = ["name", "description"];

export interface TranslationResult {
  translatedText: string;
  provider: string;
  model: string;
  usedFallback: boolean;
}

export type TranslationStatus =
  | "approved" // human-verified (seed / admin / owner)
  | "machine" // auto-translation, not yet human-approved
  | "stale" // superseded — kept visible until replacement is ready
  | "pending"
  | "rejected";
