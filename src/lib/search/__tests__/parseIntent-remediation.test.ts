import { describe, expect, it } from "vitest";
import type { Category, City, District } from "@/types/domain";
import {
  parseDirectorySearchIntent,
  queryForParsedSearchIntent,
  type SearchDictionary,
} from "../parseIntent";

const categories: Category[] = [
  {
    id: "c1",
    parentId: null,
    slug: "hotels",
    icon: null,
    imageUrl: null,
    categoryType: "primary",
    name: { en: "Hotels", tr: "Oteller", ar: "فنادق", fr: "Hôtels", ru: "Отели" },
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
    name: { en: "Clinics", tr: "Klinikler", ar: "عيادات", fr: "Cliniques", ru: "Клиники" },
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
    name: { en: "Restaurants", tr: "Restoranlar", ar: "مطاعم", fr: "Restaurants", ru: "Рестораны" },
    isActive: true,
    sortOrder: 3,
  },
];

const cities: City[] = [
  { id: "ci1", slug: "istanbul", isFeatured: true, sortOrder: 1, name: { en: "Istanbul", tr: "İstanbul", ar: "إسطنبول", fr: "Istanbul", ru: "Стамбул" } } as City,
  { id: "ci2", slug: "ankara", isFeatured: true, sortOrder: 2, name: { en: "Ankara", tr: "Ankara", ar: "أنقرة", fr: "Ankara", ru: "Анкара" } } as City,
];

const dict: SearchDictionary = { categories, cities, districts: [] as District[] };

describe("descriptive search intent remediation", () => {
  it.each([
    ["fancy restaurant", "en", "restaurants", null],
    ["cheap hotel in Istanbul", "en", "hotels", "istanbul"],
    ["dentist in Ankara", "en", "clinics", "ankara"],
    ["مطعم فاخر", "ar", "restaurants", null],
    ["hôtel pas cher", "fr", "hotels", null],
    ["ресторан в Стамбуле", "ru", "restaurants", "istanbul"],
  ] as const)(
    "does not convert descriptive modifiers into mandatory text filters for %s",
    (query, locale, categorySlug, citySlug) => {
      const intent = parseDirectorySearchIntent(query, locale, dict);

      expect(intent.matchedCategorySlug).toBe(categorySlug);
      expect(intent.matchedCitySlug).toBe(citySlug);
      expect(intent.descriptiveIntent).toBe(true);
      expect(queryForParsedSearchIntent(intent)).toBe("");
    },
  );

  it("keeps proper-name residual text as a mandatory search query", () => {
    const intent = parseDirectorySearchIntent("pasha restaurant", "en", dict);

    expect(intent.matchedCategorySlug).toBe("restaurants");
    expect(intent.remainingQuery).toBe("pasha");
    expect(intent.descriptiveIntent).toBe(false);
    expect(queryForParsedSearchIntent(intent)).toBe("pasha");
  });
});
