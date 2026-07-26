import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/types/domain";

const DEFAULT_SITE_ORIGIN = "https://turkiye-discover-hub.lovable.app";

export function configuredSiteOrigin(fallback?: string): string {
  const raw =
    process.env.VITE_PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.URL ||
    fallback ||
    DEFAULT_SITE_ORIGIN;
  return normalizeOrigin(raw);
}

export function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    return u.origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

export function isSupportedLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function safePathSegment(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[/?#\u0000-\u001F\u007F]/.test(trimmed)) return null;
  return encodeURIComponent(trimmed);
}

export function localizedPath(locale: Locale, pathWithoutLocale: string): string {
  const path = pathWithoutLocale.startsWith("/") ? pathWithoutLocale : `/${pathWithoutLocale}`;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export function absoluteUrl(locale: Locale, pathWithoutLocale = "/", origin?: string): string {
  return `${configuredSiteOrigin(origin)}${localizedPath(locale, pathWithoutLocale)}`;
}

export function defaultAbsoluteUrl(pathWithoutLocale = "/", origin?: string): string {
  return absoluteUrl(DEFAULT_LOCALE, pathWithoutLocale, origin);
}

export function stripSearchAndHash(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
