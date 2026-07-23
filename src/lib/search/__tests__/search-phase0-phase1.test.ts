import { describe, expect, it } from "vitest";
import { messages } from "@/lib/i18n/messages";
import { dirFor } from "@/lib/i18n";
import { normalize, parseDirectorySearchIntent } from "../parseIntent";
import { normalizePublicSearchFilters } from "../search-filters";
import type { Category, City, District } from "@/types/domain";

const categories: Category[] = [
  {
    id: "cat-hotels",
    parentId: null,
    slug: "hotels",
    icon: null,
    imageUrl: null,
    categoryType: "primary",
    name: { tr: "Oteller", en: "Hotels", ar: "فنادق" },
    isActive: true,
    sortOrder: 1,
  },
  {
    id: "cat-clinics",
    parentId: null,
    slug: "clinics",
    icon: null,
    imageUrl: null,
    categoryType: "primary",
    name: { tr: "Klinikler", en: "Clinics", ar: "عيادات" },
    isActive: true,
    sortOrder: 2,
  },
  {
    id: "cat-restaurants",
    parentId: null,
    slug: "restaurants",
    icon: null,
    imageUrl: null,
    categoryType: "primary",
    name: { tr: "Restoranlar", en: "Restaurants", ar: "مطاعم" },
    isActive: true,
    sortOrder: 3,
  },
];

const cities: City[] = [
  {
    id: "city-istanbul",
    countryId: "turkiye",
    slug: "istanbul",
    latitude: 0,
    longitude: 0,
    imageUrl: null,
    isFeatured: true,
    isActive: true,
    sortOrder: 1,
    name: { tr: "İstanbul", en: "Istanbul", ar: "إسطنبول" },
  },
  {
    id: "city-antalya",
    countryId: "turkiye",
    slug: "antalya",
    latitude: 0,
    longitude: 0,
    imageUrl: null,
    isFeatured: true,
    isActive: true,
    sortOrder: 2,
    name: { tr: "Antalya", en: "Antalya", ar: "أنطاليا" },
  },
];

const districts: District[] = [
  {
    id: "district-sultanahmet",
    cityId: "city-istanbul",
    slug: "sultanahmet",
    latitude: 0,
    longitude: 0,
    isActive: true,
    name: { tr: "Sultanahmet", en: "Sultanahmet", ar: "السلطان أحمد" },
  },
  {
    id: "district-basaksehir",
    cityId: "city-istanbul",
    slug: "basaksehir",
    latitude: 0,
    longitude: 0,
    isActive: true,
    name: { tr: "Başakşehir", en: "Başakşehir", ar: "باشاك شهير" },
  },
];

describe("Phase 0 encoding and search normalization", () => {
  it("keeps static UI messages free of known mojibake markers", () => {
    const allMessages = JSON.stringify(messages);
    const markerCodepoints = new Set([0xc3, 0xc2, 0xc5, 0xc4, 0xd8, 0xd9, 0xe2, 0xfffd]);
    expect([...allMessages].some((char) => markerCodepoints.has(char.codePointAt(0) ?? 0))).toBe(false);
    expect(messages.tr["brand.name"]).toContain("Türkiye");
    expect(messages.en["home.badge"]).toBe("HiTürkiye");
    expect(messages.ar["search.placeholder"]).toContain("ابحث");
    expect(dirFor("ar")).toBe("rtl");
  });

  it("parses English category, city, and district search", () => {
    const intent = parseDirectorySearchIntent("Best hotel in Sultanahmet, Istanbul", "en", {
      categories,
      cities,
      districts,
    });

    expect(intent.matchedCategorySlug).toBe("hotels");
    expect(intent.matchedCitySlug).toBe("istanbul");
    expect(intent.matchedDistrictSlug).toBe("sultanahmet");
    expect(intent.ratingIntent).toBe("top");
  });

  it("parses Turkish dotted/dotless I and family wording", () => {
    const intent = parseDirectorySearchIntent("İstanbul'da aile için klinik", "tr", {
      categories,
      cities,
      districts,
    });

    expect(intent.normalizedQuery).toContain("istanbul");
    expect(intent.matchedCitySlug).toBe("istanbul");
    expect(intent.matchedCategorySlug).toBe("clinics");
    expect(intent.audienceIntent).toBe("family");
  });

  it("parses Arabic query text and strips Arabic diacritics", () => {
    const intent = parseDirectorySearchIntent("فُنْدُق في اَلسُّلْطَان أَحْمَد", "ar", {
      categories,
      cities,
      districts,
    });

    expect(normalize("فُنْدُق")).toBe("فندق");
    expect(intent.matchedCategorySlug).toBe("hotels");
    expect(intent.matchedDistrictSlug).toBe("sultanahmet");
  });

  it("preserves current URL search parameters through canonical normalization", () => {
    expect(
      normalizePublicSearchFilters({
        query: "Restaurants",
        category: "restaurants",
        city: "istanbul",
        district: "sultanahmet",
        rating: 4,
        priceLevel: 2,
        sort: "most_reviewed",
        page: 3,
      }),
    ).toEqual({
      query: "Restaurants",
      category: "restaurants",
      city: "istanbul",
      district: "sultanahmet",
      rating: 4,
      openNow: false,
      priceLevel: 2,
      sort: "most_reviewed",
      page: 3,
      pageSize: 12,
    });
  });

  it("bounds unsupported or unsafe filter values", () => {
    expect(
      normalizePublicSearchFilters({
        query: "x".repeat(250),
        category: "../admin",
        rating: 9,
        priceLevel: 99,
        sort: "unknown" as never,
        page: -5,
        pageSize: 500,
      }),
    ).toMatchObject({
      query: "x".repeat(160),
      category: null,
      rating: null,
      priceLevel: null,
      sort: "recommended",
      page: 1,
      pageSize: 48,
    });
  });
});
