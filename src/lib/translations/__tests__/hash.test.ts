import { describe, it, expect } from "vitest";
import { computeSourceHash, normalizeSourceText } from "../hash";
import { detectLanguage } from "../detect";

describe("translation hash", () => {
  it("is deterministic and normalizes whitespace", () => {
    const a = computeSourceHash({
      text: "  Hello   world\r\n",
      sourceLanguage: "en",
      targetLanguage: "tr",
      field: "description",
    });
    const b = computeSourceHash({
      text: "Hello world",
      sourceLanguage: "en",
      targetLanguage: "tr",
      field: "description",
    });
    expect(a).toBe(b);
  });

  it("changes when target language differs", () => {
    const a = computeSourceHash({
      text: "x",
      sourceLanguage: "en",
      targetLanguage: "tr",
      field: "name",
    });
    const b = computeSourceHash({
      text: "x",
      sourceLanguage: "en",
      targetLanguage: "ar",
      field: "name",
    });
    expect(a).not.toBe(b);
  });

  it("changes when field differs", () => {
    const a = computeSourceHash({
      text: "x",
      sourceLanguage: "en",
      targetLanguage: "tr",
      field: "name",
    });
    const b = computeSourceHash({
      text: "x",
      sourceLanguage: "en",
      targetLanguage: "tr",
      field: "description",
    });
    expect(a).not.toBe(b);
  });

  it("normalizeSourceText collapses spaces", () => {
    expect(normalizeSourceText("a\t  b\n\n\n\nc")).toBe("a b\n\nc");
  });
});

describe("detectLanguage", () => {
  it("finds Arabic", () => {
    expect(detectLanguage("مرحبا بالعالم")).toBe("ar");
  });
  it("finds Turkish", () => {
    expect(detectLanguage("İstanbul'da güzel bir gün")).toBe("tr");
  });
  it("defaults to English", () => {
    expect(detectLanguage("Hello world")).toBe("en");
  });
});
