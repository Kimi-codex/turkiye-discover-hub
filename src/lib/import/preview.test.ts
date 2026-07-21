import { describe, it, expect } from "vitest";
import { computeProposedDiff, computePreviewHash, IMPORTABLE_FIELDS } from "./preview";
import type { NormalizedBusiness } from "./normalize";

const N = (over: Partial<NormalizedBusiness> = {}): NormalizedBusiness => ({
  placeId: "P1",
  name: "Test",
  originalLanguage: null,
  description: null,
  primaryCategorySource: null,
  categoriesSource: [],
  cityHint: null,
  districtHint: null,
  formattedAddress: null,
  rawAddress: null,
  latitude: null,
  longitude: null,
  phone: null,
  internationalPhone: null,
  website: null,
  googleMapsUrl: null,
  rating: null,
  reviewCount: 0,
  priceLevel: null,
  openingHours: [],
  images: [],
  reviews: [],
  popularTimes: null,
  sourceUpdatedAt: null,
  raw: {},
  ...over,
});

describe("computeProposedDiff", () => {
  it("reports all changes when there's no current row", () => {
    const d = computeProposedDiff(N({ name: "A", rating: 4.2 }), null, null);
    expect(d.blockedCount).toBe(0);
    expect(d.changedCount).toBeGreaterThan(0);
    expect(d.fields).toHaveLength(IMPORTABLE_FIELDS.length);
  });

  it("marks unchanged fields as unchanged", () => {
    const cur = { name: "A", rating: 4.2, review_count: 0 };
    const d = computeProposedDiff(N({ name: "A", rating: 4.2 }), cur, {});
    const nameField = d.fields.find((f) => f.field === "name")!;
    expect(nameField.status).toBe("unchanged");
  });

  it("blocks import over admin-curated fields", () => {
    const cur = { name: "Curated Name", rating: 4.2 };
    const d = computeProposedDiff(
      N({ name: "Import Name" }),
      cur,
      { name: { source: "admin", updated_at: "2026-01-01" } },
    );
    const nameField = d.fields.find((f) => f.field === "name")!;
    expect(nameField.status).toBe("blocked_by_curation");
    expect(d.blockedCount).toBe(1);
  });

  it("blocks import over owner-curated fields", () => {
    const cur = { website: "https://curated.example" };
    const d = computeProposedDiff(
      N({ website: "https://import.example" }),
      cur,
      { website: { source: "owner" } },
    );
    expect(d.fields.find((f) => f.field === "website")!.status).toBe("blocked_by_curation");
  });
});

describe("computePreviewHash", () => {
  it("is stable across reordered inputs", () => {
    const a = computePreviewHash({
      items: [
        { placeId: "b", intent: "insert", approved: ["name"], proposedFields: ["name"] },
        { placeId: "a", intent: "update", approved: ["rating"], proposedFields: ["rating"] },
      ],
      mappingsApproved: ["cafe", "hotel"],
      settings: { x: 1, y: 2 },
    });
    const b = computePreviewHash({
      items: [
        { placeId: "a", intent: "update", approved: ["rating"], proposedFields: ["rating"] },
        { placeId: "b", intent: "insert", approved: ["name"], proposedFields: ["name"] },
      ],
      mappingsApproved: ["hotel", "cafe"],
      settings: { y: 2, x: 1 },
    });
    expect(a).toBe(b);
  });

  it("flips when approved fields change", () => {
    const base = {
      items: [{ placeId: "a", intent: "update", approved: ["name"], proposedFields: ["name", "rating"] }],
      mappingsApproved: [],
      settings: {},
    };
    const a = computePreviewHash(base);
    const b = computePreviewHash({
      ...base,
      items: [{ ...base.items[0], approved: ["name", "rating"] }],
    });
    expect(a).not.toBe(b);
  });
});
