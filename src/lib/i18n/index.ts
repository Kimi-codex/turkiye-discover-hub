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

/** Look up a localized field, falling back through locale → en → tr → first available. */
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
  vars?: Record<string, string | number>,
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
