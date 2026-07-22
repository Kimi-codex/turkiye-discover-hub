import { describe, expect, it } from "vitest";
import { normalizeImages } from "@/lib/import/normalize";

describe("normalizeImages", () => {
  it("preserves direct URLs and Google photo references in source order", () => {
    const images = normalizeImages({
      place_id: "ChIJ_TEST",
      photos: [
        {
          url: "https://lh3.googleusercontent.com/direct-cover",
          categories: ["cover"],
          width: 1200,
          height: 800,
        },
        {
          photo_reference: "Aap_uEA_reference_only",
          width: 900,
          height: 600,
        },
        "https://lh3.googleusercontent.com/bare-url",
      ],
    });

    expect(images).toHaveLength(3);
    expect(images.map((img) => img.sortOrder)).toEqual([0, 1, 2]);
    expect(images[0]).toMatchObject({
      sourceUrl: "https://lh3.googleusercontent.com/direct-cover",
      sourceReference: null,
      isCover: true,
      googleCategory: "cover",
    });
    expect(images[1]).toMatchObject({
      sourceUrl: null,
      sourceReference: "Aap_uEA_reference_only",
      isCover: false,
    });
    expect(images[2]).toMatchObject({
      sourceUrl: "https://lh3.googleusercontent.com/bare-url",
      sourceReference: null,
      isCover: false,
    });
    expect(new Set(images.map((img) => img.sourceFingerprint)).size).toBe(3);
    expect(images[1].sourceMetadata.source_reference).toBe("Aap_uEA_reference_only");
  });

  it("drops only image entries that have neither a URL nor a source reference", () => {
    const images = normalizeImages({
      place_id: "ChIJ_TEST",
      photos: [
        { width: 100, height: 100 },
        { name: "places/abc/photos/photo-1" },
        { image_url: "https://example.com/photo.jpg" },
      ],
    });

    expect(images).toHaveLength(2);
    expect(images[0].sourceReference).toBe("places/abc/photos/photo-1");
    expect(images[1].sourceUrl).toBe("https://example.com/photo.jpg");
  });
});
