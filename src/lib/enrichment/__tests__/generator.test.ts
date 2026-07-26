import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Lovable AI provider before importing the module under test
const mockTranslate = vi.fn();
vi.mock("@/lib/translations/lovable-provider.server", () => ({
  translateWithLovableAI: (...args: unknown[]) => mockTranslate(...args),
}));

vi.mock("@/lib/translations/provider", () => ({
  SUPPORTED_LOCALES: ["tr", "en", "ar"] as const,
}));

import {
  generateAIDescription,
  generateSeoContent,
  classifyEnrichmentError,
  checkHallucinations,
  getBackoffDelay,
  ENRICHMENT_PROMPT_VERSION,
} from "../generator.server";

// ---------- Fixtures ----------

const testBusiness = {
  name: "Karaköy Balıkçısı",
  category: "Restoran",
  city: "İstanbul",
  originalLanguage: "tr",
  existingDescription: "",
};

// ---------- classifyEnrichmentError ----------

describe("classifyEnrichmentError", () => {
  it("classifies network errors as transient", () => {
    expect(classifyEnrichmentError(new Error("network timeout"))).toBe("transient");
    expect(classifyEnrichmentError(new Error("econnrefused"))).toBe("transient");
    expect(classifyEnrichmentError(new Error("fetch failed"))).toBe("transient");
    expect(classifyEnrichmentError(new Error("abort"))).toBe("transient");
  });

  it("classifies rate limits as transient", () => {
    expect(classifyEnrichmentError(new Error("429 Too Many Requests"))).toBe("transient");
    expect(classifyEnrichmentError(new Error("rate limit exceeded"))).toBe("transient");
    expect(classifyEnrichmentError(new Error("too many requests"))).toBe("transient");
  });

  it("classifies server errors as transient", () => {
    expect(classifyEnrichmentError(new Error("502 Bad Gateway"))).toBe("transient");
    expect(classifyEnrichmentError(new Error("503 Service Unavailable"))).toBe("transient");
    expect(classifyEnrichmentError(new Error("504 Gateway Timeout"))).toBe("transient");
  });

  it("classifies auth/validation errors as permanent", () => {
    expect(classifyEnrichmentError(new Error("401 Unauthorized"))).toBe("permanent");
    expect(classifyEnrichmentError(new Error("403 Forbidden"))).toBe("permanent");
    expect(classifyEnrichmentError(new Error("schema validation failed"))).toBe("permanent");
  });

  it("classifies credit errors as permanent", () => {
    expect(classifyEnrichmentError(new Error("credits_exhausted"))).toBe("permanent");
    expect(classifyEnrichmentError(new Error("402 Payment Required"))).toBe("permanent");
  });

  it("defaults unknown errors to permanent", () => {
    expect(classifyEnrichmentError(new Error("random internal error"))).toBe("permanent");
    expect(classifyEnrichmentError(new Error("timeout"))).toBe("permanent");
  });
});

// ---------- checkHallucinations ----------

describe("checkHallucinations", () => {
  it("detects phone numbers", () => {
    const warnings = checkHallucinations("Call us at +90 212 555 1234");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("\\+\\d");
  });

  it("detects email addresses", () => {
    const warnings = checkHallucinations("Email info@restaurant.com");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("detects URLs", () => {
    const warnings = checkHallucinations("Visit https://example.com");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("detects prices", () => {
    const warnings = checkHallucinations("Prices start at 50 TL");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("detects opening hours", () => {
    const warnings = checkHallucinations("Open Monday to Friday 9-5");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("detects superlatives", () => {
    const warnings = checkHallucinations("We are the best restaurant in town");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns empty for clean text", () => {
    const warnings = checkHallucinations(
      "A cozy restaurant in the heart of Istanbul offering fresh seafood with a beautiful Bosphorus view."
    );
    expect(warnings).toEqual([]);
  });
});

// ---------- getBackoffDelay ----------

describe("getBackoffDelay", () => {
  it("returns values between 1s and cap for attempt 0", () => {
    for (let i = 0; i < 50; i++) {
      const d = getBackoffDelay(0);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(2000);
    }
  });

  it("never exceeds 30s cap", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const d = getBackoffDelay(attempt);
      expect(d).toBeLessThanOrEqual(30000);
    }
  });

  it("has jitter (non-deterministic)", () => {
    const results = new Set<number>();
    for (let i = 0; i < 20; i++) results.add(getBackoffDelay(3));
    expect(results.size).toBeGreaterThan(1);
  });
});

// ---------- generateAIDescription (with mocked AI) ----------

describe("generateAIDescription", () => {
  beforeEach(() => {
    mockTranslate.mockReset();
  });

  it("returns validated description on success", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ description: "A wonderful seafood restaurant by the Bosphorus." }),
    });
    const result = await generateAIDescription(testBusiness, "tr");
    expect(result.description).toBe("A wonderful seafood restaurant by the Bosphorus.");
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON from AI", async () => {
    mockTranslate.mockResolvedValue({ translatedText: "not valid json" });
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow();
  });

  it("rejects Zod validation failure (empty description)", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ description: "" }),
    });
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow("Description must not be empty");
  });

  it("rejects Zod validation failure (missing description key)", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({}),
    });
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow();
  });

  it("rejects extra keys via strict schema", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ description: "Valid text.", extraKey: "should not be here" }),
    });
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow();
  });

  it("rejects hallucinated phone numbers", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ description: "Call us at +90 212 555 1234 for reservations." }),
    });
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow("Hallucination detected");
  });

  it("rejects hallucinated superlatives", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ description: "The best restaurant in town, top rated #1." }),
    });
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow("Hallucination detected");
  });

  it("propagates AI provider errors", async () => {
    mockTranslate.mockRejectedValue(new Error("503 Service Unavailable"));
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow("503 Service Unavailable");
  });

  it("rejects very long descriptions", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ description: "A".repeat(1001) }),
    });
    await expect(generateAIDescription(testBusiness, "tr")).rejects.toThrow("Description too long");
  });

  it("falls back to 'en' for unsupported locales", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ description: "A great place to visit." }),
    });
    const result = await generateAIDescription(testBusiness, "fr");
    expect(result.description).toBe("A great place to visit.");
  });
});

// ---------- generateSeoContent (with mocked AI) ----------

describe("generateSeoContent", () => {
  beforeEach(() => {
    mockTranslate.mockReset();
  });

  it("returns validated SEO output on success", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({
        seo_title: "Karaköy Balıkçısı - İstanbul Restoran",
        meta_description: "Karaköy Balıkçısı'nda taze deniz ürünleri ve Boğaz manzarası eşliğinde unutulmaz bir akşam yemeği.",
      }),
    });
    const result = await generateSeoContent(testBusiness, "tr");
    expect(result.seo_title.length).toBeLessThanOrEqual(60);
    expect(result.meta_description.length).toBeLessThanOrEqual(160);
  });

  it("rejects malformed JSON", async () => {
    mockTranslate.mockResolvedValue({ translatedText: "not json" });
    await expect(generateSeoContent(testBusiness, "tr")).rejects.toThrow();
  });

  it("rejects missing required fields", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ seo_title: "Title only" }),
    });
    await expect(generateSeoContent(testBusiness, "tr")).rejects.toThrow();
  });

  it("rejects empty seo_title", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({ seo_title: "", meta_description: "A valid description here." }),
    });
    await expect(generateSeoContent(testBusiness, "tr")).rejects.toThrow("SEO title must not be empty");
  });

  it("rejects overly long seo_title", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({
        seo_title: "A".repeat(61),
        meta_description: "Valid short description.",
      }),
    });
    await expect(generateSeoContent(testBusiness, "tr")).rejects.toThrow("at most 60 characters");
  });

  it("rejects overly long meta_description", async () => {
    mockTranslate.mockResolvedValue({
      translatedText: JSON.stringify({
        seo_title: "Valid Title",
        meta_description: "A".repeat(161),
      }),
    });
    await expect(generateSeoContent(testBusiness, "tr")).rejects.toThrow("at most 160 characters");
  });
});

describe("ENRICHMENT_PROMPT_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof ENRICHMENT_PROMPT_VERSION).toBe("string");
    expect(ENRICHMENT_PROMPT_VERSION.length).toBeGreaterThan(0);
  });
});
