import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

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
  const p = pathWithoutLocale === "/" ? "" : pathWithoutLocale;
  const prefix = siteUrl ?? "";
  const links: Array<{
    rel: "alternate" | "canonical";
    href: string;
    hrefLang?: string;
  }> = [];
  for (const loc of LOCALES) {
    links.push({ rel: "alternate", hrefLang: loc, href: `${prefix}/${loc}${p}` });
  }
  links.push({ rel: "alternate", hrefLang: "x-default", href: `${prefix}/${DEFAULT_LOCALE}${p}` });
  return links;
}

export function canonicalFor(locale: Locale, pathWithoutLocale: string, siteUrl?: string): string {
  const p = pathWithoutLocale === "/" ? "" : pathWithoutLocale;
  return `${siteUrl ?? ""}/${locale}${p}`;
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
