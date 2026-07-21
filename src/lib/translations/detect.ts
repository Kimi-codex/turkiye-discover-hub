/**
 * Language detection helper — deterministic, offline.
 * NOT a substitute for the value stored on the business row when known.
 *
 * Heuristic:
 *   - Arabic script → 'ar'
 *   - Turkish-specific letters (ğ, ş, ı, İ, ç, ö, ü) → 'tr'
 *   - otherwise 'en' (default)
 *
 * This runs on the server (Node crypto is used elsewhere in the pipeline).
 * Everything here is pure and testable.
 */
import type { SupportedLocale } from "./provider";

export function detectLanguage(text: string): SupportedLocale {
  const t = text ?? "";
  if (!t.trim()) return "en";
  // Arabic block
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(t)) return "ar";
  // Turkish-specific characters
  if (/[ğĞşŞçÇİıöÖüÜ]/.test(t)) return "tr";
  return "en";
}
