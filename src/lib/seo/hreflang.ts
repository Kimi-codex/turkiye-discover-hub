import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { absoluteUrl, stripSearchAndHash } from "./url";

/**
 * Build hreflang link entries for a locale-neutral path.
 * `pathWithoutLocale` should start with "/" and NOT include the language segment.
 * If `siteUrl` is provided, absolute URLs are generated.
 */
export function buildHreflang(
  pathWithoutLocale: string,
  siteUrl?: string,
): Array<{
  rel: "alternate" | "canonical";
  href: string;
  hrefLang?: string;
}> {
  const cleanPath = stripSearchAndHash(pathWithoutLocale);
  const links: Array<{
    rel: "alternate" | "canonical";
    href: string;
    hrefLang?: string;
  }> = [];
  for (const loc of LOCALES) {
    links.push({ rel: "alternate", hrefLang: loc, href: absoluteUrl(loc, cleanPath, siteUrl) });
  }
  links.push({ rel: "alternate", hrefLang: "x-default", href: absoluteUrl(DEFAULT_LOCALE, cleanPath, siteUrl) });
  return links;
}

export function canonicalFor(locale: Locale, pathWithoutLocale: string, siteUrl?: string): string {
  return absoluteUrl(locale, stripSearchAndHash(pathWithoutLocale), siteUrl);
}

const OG_LOCALE_MAP: Record<string, string> = {
  tr: "tr_TR",
  en: "en_US",
  ar: "ar_SA",
  fr: "fr_FR",
  ru: "ru_RU",
};

export function ogLocaleFor(locale: Locale): string {
  return OG_LOCALE_MAP[locale] ?? "en_US";
}
