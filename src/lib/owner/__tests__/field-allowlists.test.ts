import { describe, expect, it } from "vitest";
import {
  businessFieldsSchema,
  openingHoursSchema,
  servicesSchema,
  attributesSchema,
  translationsSchema,
  imageRequestSchema,
  schemaFor,
  REQUEST_TYPES,
} from "../field-allowlists";

describe("owner field allowlists", () => {
  it("rejects unknown business_fields keys", () => {
    expect(() =>
      businessFieldsSchema.parse({ name: "ok", owner_id: "x" } as unknown),
    ).toThrow();
  });

  it("accepts valid business_fields", () => {
    const out = businessFieldsSchema.parse({
      name: "Café X",
      phone: "+90 555 111 2233",
      website: "https://example.com",
      price_level: 2,
    });
    expect(out.name).toBe("Café X");
  });

  it("bounds price_level", () => {
    expect(() => businessFieldsSchema.parse({ price_level: 9 })).toThrow();
  });

  it("validates HH:MM hours", () => {
    expect(() =>
      openingHoursSchema.parse({
        hours: [{ day_of_week: 0, open_time: "9:00", close_time: "18:00", is_closed: false }],
      }),
    ).toThrow();
    const ok = openingHoursSchema.parse({
      hours: [{ day_of_week: 0, open_time: "09:00", close_time: "18:00", is_closed: false }],
    });
    expect(ok.hours[0].open_time).toBe("09:00");
  });

  it("caps services to 100", () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ name: `s${i}` }));
    expect(() => servicesSchema.parse({ services: rows })).toThrow();
  });

  it("enforces attribute key pattern", () => {
    expect(() =>
      attributesSchema.parse({ attributes: [{ key: "Bad Key!", value: 1 }] }),
    ).toThrow();
    const ok = attributesSchema.parse({
      attributes: [{ key: "wifi.free", value: true }],
    });
    expect(ok.attributes[0].key).toBe("wifi.free");
  });

  it("enforces translation locales", () => {
    expect(() =>
      translationsSchema.parse({ translations: [{ language: "de", name: "x" }] }),
    ).toThrow();
    const ok = translationsSchema.parse({
      translations: [{ language: "tr", name: "adı" }],
    });
    expect(ok.translations[0].language).toBe("tr");
  });

  it("rejects empty image request", () => {
    expect(() => imageRequestSchema.parse({})).toThrow();
    const ok = imageRequestSchema.parse({
      cover_image_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(ok.cover_image_id).toBeTruthy();
  });

  it("schemaFor returns a schema for each request type", () => {
    for (const t of REQUEST_TYPES) {
      expect(schemaFor(t)).toBeTruthy();
    }
  });
});
