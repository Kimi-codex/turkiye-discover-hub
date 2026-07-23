import { createContext, useContext } from "react";
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALES,
  RTL_LOCALES,
  type Locale,
  type LocalizedString,
} from "@/types/domain";
import { messages, type MessageKey } from "./messages";

export { DEFAULT_LOCALE, FALLBACK_LOCALE, LOCALES, RTL_LOCALES };
export type { Locale, MessageKey };

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return isRtl(locale) ? "rtl" : "ltr";
}

/** Look up a localized field, falling back through locale -> en -> tr -> first available. */
export function pickLocalized(
  value: LocalizedString | undefined,
  locale: Locale,
): string {
  if (!value) return "";
  return (
    value[locale] ??
    value[FALLBACK_LOCALE] ??
    value[DEFAULT_LOCALE] ??
    Object.values(value).find((v): v is string => typeof v === "string" && v.length > 0) ??
    ""
  );
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  const dict =
    (messages[locale] as Record<string, string>) ??
    (messages[FALLBACK_LOCALE] as Record<string, string>);
  let value =
    dict[key] ??
    (messages[FALLBACK_LOCALE] as Record<string, string>)[key] ??
    (messages[DEFAULT_LOCALE] as Record<string, string>)[key] ??
    (key as string);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}

// -----------------------------------------------------------------------------
// React context

interface LocaleContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  pick: (value: LocalizedString | undefined) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (e.g. root shell)
    return {
      locale: DEFAULT_LOCALE,
      dir: dirFor(DEFAULT_LOCALE),
      t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
      pick: (v) => pickLocalized(v, DEFAULT_LOCALE),
    };
  }
  return ctx;
}

export function useLocale(): Locale {
  return useLocaleContext().locale;
}

export function useT() {
  return useLocaleContext().t;
}

export { LocaleContext };

// -----------------------------------------------------------------------------
// URL helpers

/** Build a path with the given locale prefix. Always returns a leading slash. */
export function localePath(locale: Locale, path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return `/${locale}`;
  return `/${locale}${clean}`;
}

/** Given a full pathname, replace the locale segment with `next`, preserving the rest. */
export function withLocale(pathname: string, next: Locale): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return `/${next}`;
  if (isLocale(segments[0])) {
    segments[0] = next;
  } else {
    segments.unshift(next);
  }
  return "/" + segments.join("/");
}

export const LOCALE_STORAGE_KEY = "preferred-locale";

/** Windows-1252 byte values for characters outside ISO-8859-1. */
const WIN1252_EXT: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

/**
 * Repair double-encoded UTF-8 mojibake at the application data boundary.
 *
 * When UTF-8 bytes (e.g. 0xC3 0xBC for "ü") are incorrectly stored or
 * transmitted as Latin-1 characters ("Ã¼"), this function recovers the
 * original Unicode string.  Properly-encoded input passes through unchanged.
 *
 * Also handles Windows-1252 extended characters (e.g. "ÅŸ" → "ş").
 *
 * Applied automatically in `toLocalizedString` / `mapBusiness` so all
 * translated & dynamic text from the database is repaired once at the
 * ingest point.
 */
export function fixMojibake(input: string): string {
  if (!input) return input;
  /* 1. Try the fast escape/decodeURI trick (works when all mojibake
        characters are in the 0x80–0xFF range). */
  try {
    const repaired = decodeURIComponent(escape(input));
    if (repaired !== input) return repaired;
  } catch { /* fall through */ }

  /* 2. Full byte-level repair: map each character to its Windows-1252
        byte value, then decode the resulting bytes as UTF-8. */
  const bytes: number[] = [];
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code <= 0xFF) { bytes.push(code); continue; }
    const win1252 = WIN1252_EXT[code];
    if (win1252 !== undefined) { bytes.push(win1252); continue; }
    /* Character above 0xFF that is not a Windows-1252 extension —
       the string is NOT mojibake.  Abort repair. */
    return input;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch { return input; }
}
