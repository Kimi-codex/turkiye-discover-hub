import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

/**
 * Build hreflang link entries for a locale-neutral path.
 * `pathWithoutLocale` should start with "/" and NOT include the language segment.
 */
export function buildHreflang(pathWithoutLocale: string): Array<{
  rel: "alternate" | "canonical";
  href: string;
  hrefLang?: string;
}> {
  const p = pathWithoutLocale === "/" ? "" : pathWithoutLocale;
  const links: Array<{
    rel: "alternate" | "canonical";
    href: string;
    hrefLang?: string;
  }> = [];
  for (const loc of LOCALES) {
    links.push({ rel: "alternate", hrefLang: loc, href: `/${loc}${p}` });
  }
  links.push({ rel: "alternate", hrefLang: "x-default", href: `/${DEFAULT_LOCALE}${p}` });
  return links;
}

export function canonicalFor(locale: Locale, pathWithoutLocale: string): string {
  const p = pathWithoutLocale === "/" ? "" : pathWithoutLocale;
  return `/${locale}${p}`;
}
