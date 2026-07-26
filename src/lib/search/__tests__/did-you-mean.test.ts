import { describe, expect, it } from "vitest";
import { rankDidYouMeanCandidates } from "../did-you-mean.server";

describe("did-you-mean candidate ranking", () => {
  it("includes canonical business names when no translation candidate exists", () => {
    const suggestions = rankDidYouMeanCandidates("Demo Clin", [
      { text: "Demo Clinic", type: "business" },
    ]);

    expect(suggestions).toEqual([{ text: "Demo Clinic", type: "business" }]);
  });

  it("deduplicates canonical and translated candidates conservatively", () => {
    const suggestions = rankDidYouMeanCandidates("demo clin", [
      { text: "Demo Clinic", type: "business" },
      { text: "demo clinic", type: "business" },
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({ text: "Demo Clinic", type: "business" });
  });
});
