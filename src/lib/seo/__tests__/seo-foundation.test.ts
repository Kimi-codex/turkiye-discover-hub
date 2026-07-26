import { describe, expect, it } from "vitest";
import type { Business } from "@/types/domain";
import { buildHreflang, canonicalFor } from "../hreflang";
import {
  businessItemListJsonLd,
  localBusinessJsonLd,
  safeJsonLdStringify,
} from "../jsonld";

const baseBusiness: Business = {
  id: "business-1",
  placeId: "place-1",
  name: "Demo </script> Clinic",
  slug: "demo-clinic",
  originalLanguage: "tr",
  description: { en: "Approved public description" },
  primaryCategory: {
    id: "cat-1",
    parentId: null,
    slug: "clinics",
    icon: null,
    imageUrl: null,
    categoryType: "primary",
    name: { en: "Clinics" },
    isActive: true,
    sortOrder: 1,
  },
  categories: [],
  city: {
    id: "city-1",
    countryId: "tr",
    slug: "istanbul",
    latitude: 41,
    longitude: 29,
    imageUrl: null,
    isFeatured: true,
    isActive: true,
    sortOrder: 1,
    name: { en: "Istanbul" },
  },
  district: null,
  address: "Demo Street 1",
  latitude: 41.01,
  longitude: 28.97,
  phone: "+90 555 000 0000",
  internationalPhone: null,
  email: null,
  website: null,
  googleMapsUrl: null,
  rating: 4.6,
  reviewCount: 12,
  priceLevel: 2,
  status: "published",
  source: "google_json",
  isFeatured: false,
  isVerified: false,
  images: [],
  openingHours: [],
  services: [],
  attributes: [],
  ownerId: null,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-02T00:00:00Z",
};

describe("SEO foundation helpers", () => {
  it("builds absolute canonicals and reciprocal hreflang alternates", () => {
    expect(canonicalFor("en", "/place/demo-clinic")).toMatch(/^https:\/\/.+\/en\/place\/demo-clinic$/);

    const alternates = buildHreflang("/place/demo-clinic");
    expect(alternates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "alternate", hrefLang: "en" }),
        expect.objectContaining({ rel: "alternate", hrefLang: "tr" }),
        expect.objectContaining({ rel: "alternate", hrefLang: "x-default" }),
      ]),
    );
    expect(alternates.every((link) => String(link.href).startsWith("https://"))).toBe(true);
  });

  it("escapes JSON-LD script-breakout characters", () => {
    const serialized = safeJsonLdStringify({ name: "Demo </script> & Co" });
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
  });

  it("emits LocalBusiness JSON-LD only with valid rating and coordinates", () => {
    const jsonLd = localBusinessJsonLd(baseBusiness, "en", "https://example.com/en/place/demo-clinic");
    expect(jsonLd["@type"]).toBe("MedicalBusiness");
    expect(jsonLd.aggregateRating).toMatchObject({ ratingValue: 4.6, reviewCount: 12 });
    expect(jsonLd.geo).toMatchObject({ latitude: 41.01, longitude: 28.97 });

    const withoutTrustworthyRating = localBusinessJsonLd(
      { ...baseBusiness, rating: 0, reviewCount: 0, latitude: 0, longitude: 0 },
      "en",
      "https://example.com/en/place/demo-clinic",
    );
    expect(withoutTrustworthyRating.aggregateRating).toBeUndefined();
    expect(withoutTrustworthyRating.geo).toBeUndefined();
  });

  it("matches ItemList JSON-LD order to visible business order", () => {
    const second = { ...baseBusiness, id: "business-2", name: "Second", slug: "second" };
    const itemList = businessItemListJsonLd([baseBusiness, second], (business) => `/en/place/${business.slug}`);
    expect(itemList.numberOfItems).toBe(2);
    expect(itemList.itemListElement).toEqual([
      expect.objectContaining({ position: 1, name: baseBusiness.name, url: "/en/place/demo-clinic" }),
      expect.objectContaining({ position: 2, name: "Second", url: "/en/place/second" }),
    ]);
  });
});
