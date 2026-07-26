import type { Locale } from "@/types/domain";

export type JsonLdBreadcrumb = {
  label: string;
  url: string;
};

export function breadcrumbJsonLd(
  items: JsonLdBreadcrumb[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      item: item.url,
    })),
  };
}

export function websiteJsonLd(
  siteUrl: string,
  name: string,
  description: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    description,
    url: siteUrl,
  };
}

export function collectionPageJsonLd(
  url: string,
  name: string,
  description: string,
  numberOfItems: number,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url,
    numberOfItems,
  };
}
