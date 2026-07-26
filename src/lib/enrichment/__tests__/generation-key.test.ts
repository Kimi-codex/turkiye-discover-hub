import { describe, expect, it } from "vitest";
import { computeSourceHash, pickSourceHashLabel } from "../generation-key";

const translations = [
  { language_code: "en", name: "Restaurants" },
  { language_code: "tr", name: "Restoranlar" },
  { language_code: "ar", name: "مطاعم" },
];

function source(overrides: Partial<Parameters<typeof computeSourceHash>[0]> = {}) {
  return {
    name: "Demo Business",
    category: "Restaurants",
    city: "Istanbul",
    originalLanguage: "en",
    existingDescription: "",
    ...overrides,
  };
}

describe("Phase C source hash inputs", () => {
  it("uses the original-language Turkish label without English fallback", () => {
    expect(pickSourceHashLabel(translations, "tr")).toBe("Restoranlar");
  });

  it("uses the original-language Arabic label without English fallback", () => {
    expect(pickSourceHashLabel(translations, "ar")).toBe("مطاعم");
  });

  it("uses the English label for English original-language businesses", () => {
    expect(pickSourceHashLabel(translations, "en")).toBe("Restaurants");
  });

  it("rejects stale content when source fields change", () => {
    const current = computeSourceHash(source({ category: "Restoranlar", originalLanguage: "tr" }));
    const changed = computeSourceHash(source({ category: "Klinikler", originalLanguage: "tr" }));

    expect(changed).not.toBe(current);
  });

  it("keeps unchanged source content valid across repeated hash calculations", () => {
    const first = computeSourceHash(source({ category: "مطاعم", city: "إسطنبول", originalLanguage: "ar" }));
    const second = computeSourceHash(source({ category: "مطاعم", city: "إسطنبول", originalLanguage: "ar" }));

    expect(second).toBe(first);
  });
});
