import { describe, it, expect } from "vitest";
import { parseDirectorySearchIntent, pickClarifyingQuestion } from "../parseIntent";
import type { Category, City, District } from "@/types/domain";

const categories: Category[] = [
  {
    id: "c1",
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
    id: "c2",
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
    id: "c3",
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
    id: "ci1",
    slug: "istanbul",
    isFeatured: true,
    sortOrder: 1,
    name: { tr: "İstanbul", en: "Istanbul", ar: "إسطنبول" },
  } as City,
  {
    id: "ci2",
    slug: "antalya",
    isFeatured: true,
    sortOrder: 2,
    name: { tr: "Antalya", en: "Antalya", ar: "أنطاليا" },
  } as City,
];

const districts: District[] = [
  {
    id: "d1",
    cityId: "ci1",
    slug: "sultanahmet",
    sortOrder: 1,
    latitude: 0,
    longitude: 0,
    isActive: true,
    name: { tr: "Sultanahmet", en: "Sultanahmet", ar: "السلطان أحمد" },
  } as unknown as District,
  {
    id: "d2",
    cityId: "ci1",
    slug: "basaksehir",
    sortOrder: 2,
    latitude: 0,
    longitude: 0,
    isActive: true,
    name: { tr: "Başakşehir", en: "Başakşehir", ar: "باشاك شهير" },
  } as unknown as District,
];

const dict = { categories, cities, districts };

describe("parseDirectorySearchIntent", () => {
  it("parses English hotel + city + district", () => {
    const r = parseDirectorySearchIntent(
      "Best hotel in Sultanahmet, Istanbul",
      "en",
      dict,
    );
    expect(r.matchedCategorySlug).toBe("hotels");
    expect(r.matchedCitySlug).toBe("istanbul");
    expect(r.matchedDistrictSlug).toBe("sultanahmet");
    expect(r.ratingIntent).toBe("top");
    expect(r.confidence).toBe("high");
  });

  it("parses Turkish family hotel in Antalya", () => {
    const r = parseDirectorySearchIntent(
      "Antalya'da aile oteli",
      "tr",
      dict,
    );
    expect(r.matchedCategorySlug).toBe("hotels");
    expect(r.matchedCitySlug).toBe("antalya");
    expect(r.audienceIntent).toBe("family");
  });

  it("parses Arabic dentist in Başakşehir", () => {
    const r = parseDirectorySearchIntent(
      "عيادة أسنان في باشاك شهير",
      "ar",
      dict,
    );
    expect(r.matchedCategorySlug).toBe("clinics");
    expect(r.matchedDistrictSlug).toBe("basaksehir");
  });

  it("falls back to low confidence for unknown text", () => {
    const r = parseDirectorySearchIntent("random gibberish xyz", "en", dict);
    expect(r.confidence).toBe("low");
    expect(r.matchedCategorySlug).toBeNull();
    expect(r.matchedCitySlug).toBeNull();
  });

  it("extracts price level from $ symbols", () => {
    const r = parseDirectorySearchIntent("hotel $$$", "en", dict);
    expect(r.priceLevel).toBe(3);
  });

  it("picks a hotel clarification question", () => {
    const r = parseDirectorySearchIntent("hotel in istanbul", "en", dict);
    const q = pickClarifyingQuestion(r);
    expect(q).toMatch(/^search\.q\.hotel_/);
  });
});
