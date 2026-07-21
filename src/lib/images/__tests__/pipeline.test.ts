import { describe, it, expect } from "vitest";
import { sniffImageType } from "@/lib/images/magic-bytes";
import { sha256Hex, buildImageKey } from "@/lib/images/hash";

describe("sniffImageType", () => {
  it("detects JPEG", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(b)).toBe("image/jpeg");
  });
  it("detects PNG", () => {
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(b)).toBe("image/png");
  });
  it("detects WebP", () => {
    const b = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(b)).toBe("image/webp");
  });
  it("returns unknown for short/garbage", () => {
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBe("unknown");
    expect(sniffImageType(new Uint8Array(12))).toBe("unknown");
  });
});

describe("hash + key", () => {
  it("hashes deterministically", async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 3]));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("builds canonical key businesses/{id}/{place_id}/{sha256}.{ext}", () => {
    const k = buildImageKey({
      businessId: "biz-1",
      placeId: "ChIJ_ABC-xyz.123",
      contentHash: "abcdef0123",
      ext: "webp",
    });
    expect(k).toBe("businesses/biz-1/chij-abc-xyz-123/abcdef0123.webp");
  });
  it("uses owner-{uid} fallback shape via sanitizer", () => {
    const k = buildImageKey({
      businessId: "biz-1",
      placeId: "owner-uid-123",
      contentHash: "deadbeef",
      ext: "jpg",
    });
    expect(k).toBe("businesses/biz-1/owner-uid-123/deadbeef.jpg");
  });
});
