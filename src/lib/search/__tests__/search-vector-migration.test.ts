import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

describe("Phase E search-vector migration safety", () => {
  it("does not run an unbounded full-table search-vector rebuild during migration", () => {
    const phaseEAdditions = readFileSync(
      resolve(migrationsDir, "20260726103000_phase_e_search_experience_additions.sql"),
      "utf8",
    );
    const descriptionExpansion = readFileSync(
      resolve(migrationsDir, "20260726100040_add_description_to_search_vector.sql"),
      "utf8",
    );

    expect(phaseEAdditions).not.toMatch(/select\s+public\.rebuild_search_vectors\s*\(\s*\)\s*;/i);
    expect(descriptionExpansion).not.toMatch(/select\s+public\.rebuild_search_vectors\s*\(\s*\)\s*;/i);
    expect(phaseEAdditions).toMatch(/create\s+or\s+replace\s+function\s+public\.backfill_business_search_vectors_batch/i);
  });

  it("uses after-write refresh triggers so inserted rows can receive category and alias terms", () => {
    const phaseEAdditions = readFileSync(
      resolve(migrationsDir, "20260726103000_phase_e_search_experience_additions.sql"),
      "utf8",
    );
    const publishRefresh = readFileSync(
      resolve(migrationsDir, "20260726104000_refresh_search_vector_on_publish.sql"),
      "utf8",
    );

    expect(phaseEAdditions).toMatch(/after\s+insert\s+or\s+update\s+of\s+name,\s+slug,\s+description,\s+primary_category_id/i);
    expect(publishRefresh).toMatch(/after\s+insert\s+or\s+update\s+of\s+name,\s+slug,\s+description,\s+primary_category_id,\s+status/i);
    expect(phaseEAdditions).toMatch(/refresh_business_search_vector_after_category_link/i);
    expect(phaseEAdditions).toMatch(/public\.refresh_business_search_vector\(new\.id\)/i);
  });

  it("keeps migration timestamp prefixes unique", () => {
    const prefixes = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.slice(0, 14));

    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
