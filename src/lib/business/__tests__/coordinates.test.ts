import { describe, expect, it } from "vitest";
import { areValidCoordinates } from "../coordinates";

describe("areValidCoordinates", () => {
  it("accepts valid latitude and longitude", () => {
    expect(areValidCoordinates(41.0082, 28.9784)).toBe(true);
  });

  it("rejects missing, out-of-range, and zero coordinates", () => {
    expect(areValidCoordinates(Number.NaN, 28.9784)).toBe(false);
    expect(areValidCoordinates(91, 28.9784)).toBe(false);
    expect(areValidCoordinates(41.0082, 181)).toBe(false);
    expect(areValidCoordinates(0, 0)).toBe(false);
  });
});
