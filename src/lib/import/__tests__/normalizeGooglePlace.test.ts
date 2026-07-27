import { describe, expect, it } from "vitest";
import { normalizeGoogleMapsUrl, normalizeGooglePlace, validateNormalizedBusiness } from "@/lib/import/normalize";

describe("normalizeGooglePlace — clinic alias early-return fix", () => {
  it("resolves Place_id when place_id/placeId are absent", () => {
    const result = normalizeGooglePlace({
      Place_id: "ChIJ_TURKEY_CLINIC",
      Title: "İstanbul Clinic",
      Address: "İstiklal Cd. No:1",
      City: "Beyoğlu",
      State: "İstanbul",
    });

    expect(result).not.toBeNull();
    expect(result!.placeId).toBe("ChIJ_TURKEY_CLINIC");
    expect(result!.name).toBe("İstanbul Clinic");
    const validation = validateNormalizedBusiness(result);
    expect(validation.ok).toBe(true);
  });

  it("uses Title when name is absent", () => {
    const result = normalizeGooglePlace({
      Place_id: "ChIJ_TITLE_TEST",
      Title: "Ankara Hastanesi",
    });

    expect(result).not.toBeNull();
    expect(result!.placeId).toBe("ChIJ_TITLE_TEST");
    expect(result!.name).toBe("Ankara Hastanesi");
  });

  it("preserves standard Google place_id path unchanged", () => {
    const result = normalizeGooglePlace({
      place_id: "ChIJ_STANDARD",
      name: "Standard Business",
      formatted_address: "123 Main St",
      rating: 4.5,
      user_ratings_total: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.placeId).toBe("ChIJ_STANDARD");
    expect(result!.name).toBe("Standard Business");
    expect(result!.reviewCount).toBe(100);
  });

  it("returns null when both place_id and Place_id are missing", () => {
    const result = normalizeGooglePlace({
      Title: "No Place ID Here",
      name: "No Place ID Here",
    });

    expect(result).toBeNull();
  });

  it("standard place_id takes precedence over clinic Place_id when both are present", () => {
    const result = normalizeGooglePlace({
      place_id: "ChIJ_STANDARD",
      Place_id: "ChIJ_CLINIC",
      name: "Business",
    });

    expect(result).not.toBeNull();
    expect(result!.placeId).toBe("ChIJ_STANDARD");
  });

  it("rejects unsafe clinic website and maps URL aliases", () => {
    const result = normalizeGooglePlace({
      Place_id: "ChIJ_UNSAFE_LINKS",
      Title: "Unsafe Links Clinic",
      Website: "javascript:alert(1)",
      Page_URL: "javascript:google.com/maps/alert(1)",
    });

    expect(result).not.toBeNull();
    expect(result!.website).toBeNull();
    expect(result!.googleMapsUrl).toBeNull();
  });

  it("accepts only real Google Maps URLs for map links", () => {
    expect(normalizeGoogleMapsUrl("https://www.google.com/maps/place/Istanbul")).toBe(
      "https://www.google.com/maps/place/Istanbul",
    );
    expect(normalizeGoogleMapsUrl("https://google.com.evil.test/maps/place/Istanbul")).toBeNull();
  });
});
