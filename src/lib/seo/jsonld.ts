import type { Business } from "@/types/domain";
import { pickLocalized } from "@/lib/i18n";
import { getBusinessImageUrl } from "@/lib/images/storage";
import { areValidCoordinates } from "@/lib/business/coordinates";

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

export function organizationJsonLd(
  siteUrl: string,
  name: string,
  logoUrl?: string | null,
): Record<string, unknown> {
  return withoutUndefined({
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: siteUrl,
    logo: logoUrl || undefined,
  });
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

export function businessItemListJsonLd(
  businesses: Business[],
  businessUrl: (business: Business) => string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: businesses.length,
    itemListElement: businesses.map((business, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: businessUrl(business),
      name: business.name,
    })),
  };
}

export function localBusinessJsonLd(
  business: Business,
  locale: import("@/types/domain").Locale,
  canonicalUrl: string,
): Record<string, unknown> {
  const image = getBusinessImageUrl(
    business.images.find((i) => i.isCover) ?? business.images[0],
  );
  const openingHours = business.openingHours
    .filter((h) => !h.isClosed && h.openTime && h.closeTime)
    .map((h) => {
      const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
      return `${days[h.dayOfWeek]} ${h.openTime}-${h.closeTime}`;
    });

  const rating =
    business.rating > 0 && business.reviewCount > 0
      ? {
          "@type": "AggregateRating",
          ratingValue: Number(business.rating.toFixed(1)),
          reviewCount: business.reviewCount,
          bestRating: 5,
          worstRating: 1,
        }
      : undefined;

  return withoutUndefined({
    "@context": "https://schema.org",
    "@type": schemaTypeForCategory(business.primaryCategory.slug),
    name: business.name,
    url: canonicalUrl,
    image: image || undefined,
    description: pickLocalized(business.description, locale) || undefined,
    telephone: business.phone ?? undefined,
    address: business.address
      ? {
          "@type": "PostalAddress",
          streetAddress: business.address,
          addressLocality: pickLocalized(business.city?.name, locale) || undefined,
          addressRegion: business.district ? pickLocalized(business.district.name, locale) : undefined,
          addressCountry: "TR",
        }
      : undefined,
    geo: areValidCoordinates(business.latitude, business.longitude)
      ? {
          "@type": "GeoCoordinates",
          latitude: business.latitude,
          longitude: business.longitude,
        }
      : undefined,
    openingHours: openingHours.length > 0 ? openingHours : undefined,
    aggregateRating: rating,
    priceRange: business.priceLevel ? "$".repeat(business.priceLevel) : undefined,
  });
}

function schemaTypeForCategory(slug: string): string {
  if (slug.includes("restaurant")) return "Restaurant";
  if (slug.includes("cafe")) return "CafeOrCoffeeShop";
  if (slug.includes("hotel")) return "Hotel";
  if (slug.includes("clinic") || slug.includes("hospital") || slug.includes("health")) return "MedicalBusiness";
  return "LocalBusiness";
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined).filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined && item !== null && item !== "") out[key] = withoutUndefined(item);
    }
    return out as T;
  }
  return value;
}
