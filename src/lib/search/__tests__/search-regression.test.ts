import { describe, expect, it } from "vitest";
import type { Category, City, District } from "@/types/domain";
import {
  parseDirectorySearchIntent,
  removeConsumedIntentTerm,
} from "../parseIntent";
import { removePublicSearchChip } from "../search-url-state";
import { fixMojibake } from "@/lib/i18n";

const categories: Category[] = [
  {
    id: "restaurants",
    parentId: null,
    slug: "restaurants",
    icon: null,
    imageUrl: null,
    categoryType: "primary",
    name: { tr: "Restoranlar", en: "Restaurants", ar: "مطاعم" },
    isActive: true,
    sortOrder: 1,
  },
];

const cities: City[] = [];
const districts: District[] = [];
const dict = { categories, cities, districts };

function categoryChip(query: string) {
  const intent = parseDirectorySearchIntent(query, "ar", dict);
  const chip = intent.interpretation.find((item) => item.urlParam === "category");
  expect(chip).toBeDefined();
  return { intent, chip: chip! };
}

describe("public search regression behavior", () => {
  it.each([
    ["مطعم", ""],
    ["مطعم راقي", ""],
    ["restaurant", ""],
    ["RESTORENT", ""],
    ["مطعم السلطان", "السلطان"],
  ])("maps %s to category plus residual query %s", (query, remainingQuery) => {
    const intent = parseDirectorySearchIntent(query, "ar", dict);
    expect(intent.matchedCategorySlug).toBe("restaurants");
    expect(intent.remainingQuery).toBe(remainingQuery);
  });

  it("removes the consumed category term from the query", () => {
    const { intent } = categoryChip("مطعم");
    expect(removeConsumedIntentTerm("مطعم", intent, "category")).toBe("");

    const residual = categoryChip("مطعم السلطان");
    expect(removeConsumedIntentTerm("مطعم السلطان", residual.intent, "category")).toBe("السلطان");
  });

  it("does not reconstruct a removed category from the unchanged query", () => {
    const { intent, chip } = categoryChip("مطعم السلطان");
    const next = removePublicSearchChip(
      { q: "مطعم السلطان", category: null, city: null, district: null, page: 4, sort: "recommended" },
      chip,
      intent,
    );

    expect(next).toEqual({ q: "السلطان" });
    expect(parseDirectorySearchIntent(String(next.q), "ar", dict).matchedCategorySlug).toBeNull();
  });

  it("clears the final chip to the clean localized search state", () => {
    const { intent, chip } = categoryChip("مطعم");
    const next = removePublicSearchChip(
      { q: "مطعم", category: null, city: null, district: null, page: 3, sort: "recommended", clarify: "x" },
      chip,
      intent,
    );
    expect(next).toEqual({});
  });

  it("preserves unrelated filters while resetting pagination", () => {
    const { intent, chip } = categoryChip("مطعم");
    const next = removePublicSearchChip(
      { q: "مطعم", category: null, city: "istanbul", district: "kadikoy", rating: 4, page: 3, sort: "most_reviewed" },
      chip,
      intent,
    );
    expect(next).toEqual({ city: "istanbul", district: "kadikoy", rating: 4, sort: "most_reviewed" });
    expect(next.page).toBeUndefined();
  });

  it("sets descriptiveIntent=true when category is matched", () => {
    const intent = parseDirectorySearchIntent("مطعم غالي", "ar", dict);
    expect(intent.matchedCategorySlug).toBe("restaurants");
    expect(intent.descriptiveIntent).toBe(true);
  });

  it("sets descriptiveIntent=false when no structured match found", () => {
    const intent = parseDirectorySearchIntent("غالي", "ar", dict);
    expect(intent.matchedCategorySlug).toBeNull();
    expect(intent.descriptiveIntent).toBe(false);
  });

  it("does not use remaining query as filter when descriptiveIntent is true", () => {
    const { intent, chip } = categoryChip("مطعم غالي");
    expect(intent.descriptiveIntent).toBe(true);
    expect(intent.remainingQuery).toBe("غالي");
  });

  it("parses Arabic mixed descriptor without hardcoded word list dependency", () => {
    const intent = parseDirectorySearchIntent("مطعم غالي", "ar", dict);
    expect(intent.matchedCategorySlug).toBe("restaurants");
    expect(intent.descriptiveIntent).toBe(true);
    expect(intent.remainingQuery).toBe("غالي");
  });

  it("parses Turkish search with city and category", () => {
    const citiesWithIstanbul: City[] = [{
      id: "city-1", slug: "istanbul", countryId: "tr",
      latitude: 0, longitude: 0, imageUrl: null, isFeatured: true, isActive: true,
      sortOrder: 1, name: { tr: "İstanbul", en: "Istanbul", ar: "إسطنبول" },
    }];
    const intent = parseDirectorySearchIntent("İstanbul restoran", "tr", { categories, cities: citiesWithIstanbul, districts });
    expect(intent.matchedCitySlug).toBe("istanbul");
    expect(intent.matchedCategorySlug).toBe("restaurants");
    expect(intent.descriptiveIntent).toBe(true);
  });

  it("parses English combined query as descriptive intent", () => {
    const intent = parseDirectorySearchIntent("fancy restaurant", "en", dict);
    expect(intent.matchedCategorySlug).toBe("restaurants");
    expect(intent.descriptiveIntent).toBe(true);
  });

  it("uses raw query as filter when no structured intent", () => {
    const intent = parseDirectorySearchIntent("Hilton Istanbul", "en", dict);
    expect(intent.matchedCategorySlug).toBeNull();
    expect(intent.matchedCitySlug).toBeNull();
    expect(intent.descriptiveIntent).toBe(false);
    expect(intent.remainingQuery).toBeTruthy();
  });
});

describe("fixMojibake encoding repair", () => {
  it("repairs classic Turkish double-encoding mojibake", () => {
    expect(fixMojibake("TÃ¼rkiye")).toBe("Türkiye");
    expect(fixMojibake("BaÅŸakÅŸehir")).toBe("Başakşehir");
    expect(fixMojibake("KadÄ±kÃ¶y")).toBe("Kadıköy");
  });

  it("passes through already-correct Unicode strings", () => {
    expect(fixMojibake("Türkiye")).toBe("Türkiye");
    expect(fixMojibake("Başakşehir")).toBe("Başakşehir");
    expect(fixMojibake("Kadıköy")).toBe("Kadıköy");
    expect(fixMojibake("İstanbul")).toBe("İstanbul");
  });

  it("passes through Arabic text unchanged", () => {
    expect(fixMojibake("مرحبا بالعالم")).toBe("مرحبا بالعالم");
    expect(fixMojibake("إسطنبول")).toBe("إسطنبول");
  });

  it("handles empty and short strings gracefully", () => {
    expect(fixMojibake("")).toBe("");
    expect(fixMojibake("a")).toBe("a");
    expect(fixMojibake("123")).toBe("123");
  });
});
