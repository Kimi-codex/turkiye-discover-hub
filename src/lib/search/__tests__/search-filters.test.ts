import { describe, it, expect } from "vitest";
import { normalizePublicSearchFilters, sortColumn } from "../search-filters";

describe("sortColumn", () => {
  it("recommended maps to ranking_score descending", () => {
    const { column, ascending } = sortColumn("recommended");
    expect(column).toBe("ranking_score");
    expect(ascending).toBe(false);
  });

  it("highest_rated maps to rating descending", () => {
    const { column, ascending } = sortColumn("highest_rated");
    expect(column).toBe("rating");
    expect(ascending).toBe(false);
  });

  it("most_reviewed maps to review_count descending", () => {
    const { column, ascending } = sortColumn("most_reviewed");
    expect(column).toBe("review_count");
    expect(ascending).toBe(false);
  });

  it("recently_added maps to created_at descending", () => {
    const { column, ascending } = sortColumn("recently_added");
    expect(column).toBe("created_at");
    expect(ascending).toBe(false);
  });

  it("name maps to name ascending", () => {
    const { column, ascending } = sortColumn("name");
    expect(column).toBe("name");
    expect(ascending).toBe(true);
  });

  it("defaults to ranking_score descending for unknown sort", () => {
    const { column, ascending } = sortColumn("unknown" as never);
    expect(column).toBe("ranking_score");
    expect(ascending).toBe(false);
  });
});

describe("normalizePublicSearchFilters", () => {
  it("preserves valid search filters", () => {
    const result = normalizePublicSearchFilters({
      query: "restoran",
      category: "restaurants",
      city: "istanbul",
      sort: "recommended",
      page: 2,
      pageSize: 24,
    });
    expect(result.query).toBe("restoran");
    expect(result.category).toBe("restaurants");
    expect(result.city).toBe("istanbul");
    expect(result.sort).toBe("recommended");
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(24);
  });

  it("clamps page to minimum 1", () => {
    expect(normalizePublicSearchFilters({ page: -5 }).page).toBe(1);
    expect(normalizePublicSearchFilters({ page: 0 }).page).toBe(1);
  });

  it("caps pageSize at maximum", () => {
    expect(normalizePublicSearchFilters({ pageSize: 999 }).pageSize).toBe(48);
  });
});
