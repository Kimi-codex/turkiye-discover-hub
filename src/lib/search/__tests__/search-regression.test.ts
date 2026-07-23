import { describe, expect, it } from "vitest";
import type { Category, City, District } from "@/types/domain";
import {
  parseDirectorySearchIntent,
  removeConsumedIntentTerm,
} from "../parseIntent";
import { removePublicSearchChip } from "../search-url-state";

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
});
