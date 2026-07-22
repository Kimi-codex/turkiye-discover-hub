import { describe, expect, it } from "vitest";
import { detectSchema, suggestFieldMapping } from "@/lib/import/schema-detector";

describe("schema-detector", () => {
  it("does not classify Google photo references as source_url", () => {
    const schema = detectSchema([
      {
        place_id: "ChIJ_TEST",
        name: "Test business",
        photos: [{ photo_reference: "Aap_reference", width: 800, height: 600 }],
      },
    ]);

    const mapping = suggestFieldMapping(schema);
    const photoReference = mapping.find((row) => row.sourcePath === "photos[].photo_reference");

    expect(photoReference).toMatchObject({
      targetTable: "business_images",
      targetColumn: "source_metadata",
      transform: "photoReference",
    });
  });
});
