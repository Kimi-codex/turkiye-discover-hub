import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/types/domain";

const DEVELOPMENT_SITE_ORIGIN = "https://example.invalid";

function configuredRawOrigin(fallback?: string): string | undefined {
  return (
    process.env.VITE_PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.URL ||
    fallback
  );
}

export function configuredSiteOrigin(fallback?: string): string {
  const raw = configuredRawOrigin(fallback);
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Missing production site origin. Set VITE_PUBLIC_SITE_URL, PUBLIC_SITE_URL, SITE_URL, URL, or pass a request origin.",
      );
    }
    return DEVELOPMENT_SITE_ORIGIN;
  }
  return normalizeOrigin(raw);
}

export function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    return u.origin;
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Invalid production site origin: ${origin}`);
    }
    return DEVELOPMENT_SITE_ORIGIN;
  }
}

export function isSupportedLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function safePathSegment(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[/?#]/.test(trimmed)) return null;
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);
    if (code <= 31 || code === 127) return null;
  }
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
