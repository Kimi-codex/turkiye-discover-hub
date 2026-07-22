/**
 * Pure preview / diff helpers. No I/O.
 *
 * Given a normalized business (from an import row) and the current DB row
 * (if any) plus field_sources metadata, compute:
 *   - intent: "insert" | "update" | "noop" | "needs_mapping" | "invalid"
 *   - proposed_diff: field-level { current, proposed, source } tuples
 *
 * Precedence: fields whose current source is "admin" or "owner" are
 * protected from imports and reported as `blocked_by_curation` rather
 * than "update".
 */
import type { NormalizedBusiness } from "./normalize";
import { sha256Hex } from "@/lib/utils/sha256";

/** Fields the importer is allowed to write. Anything outside is ignored. */
export const IMPORTABLE_FIELDS = [
  "name",
  "description",
  "formatted_address",
  "latitude",
  "longitude",
  "phone",
  "international_phone",
  "website",
  "google_maps_url",
  "rating",
  "review_count",
  "price_level",
  "popular_times",
] as const;

export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

export interface FieldChange {
  field: ImportableField;
  current: unknown;
  proposed: unknown;
  source: "admin" | "owner" | "import" | "unset";
  status: "changed" | "unchanged" | "blocked_by_curation";
}

export interface ProposedDiff {
  fields: FieldChange[];
  changedCount: number;
  blockedCount: number;
}

type FieldSources = Record<string, { source?: string; updated_at?: string }>;

function normalizedValue(source: NormalizedBusiness, field: ImportableField): unknown {
  switch (field) {
    case "name": return source.name;
    case "description": return source.description;
    case "formatted_address": return source.formattedAddress;
    case "latitude": return source.latitude;
    case "longitude": return source.longitude;
    case "phone": return source.phone;
    case "international_phone": return source.internationalPhone;
    case "website": return source.website;
    case "google_maps_url": return source.googleMapsUrl;
    case "rating": return source.rating;
    case "review_count": return source.reviewCount;
    case "price_level": return source.priceLevel;
    case "popular_times": return source.popularTimes ?? null;
  }
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

export function computeProposedDiff(
  normalized: NormalizedBusiness,
  current: Record<string, unknown> | null,
  fieldSources: FieldSources | null,
): ProposedDiff {
  const fields: FieldChange[] = [];
  let changedCount = 0;
  let blockedCount = 0;
  const fs = fieldSources ?? {};
  for (const field of IMPORTABLE_FIELDS) {
    const proposed = normalizedValue(normalized, field);
    const curVal = current ? (current[field] ?? null) : null;
    const src = (fs[field]?.source as FieldChange["source"]) ?? "unset";
    if (eq(curVal, proposed)) {
      fields.push({ field, current: curVal, proposed, source: src, status: "unchanged" });
      continue;
    }
    if (current && (src === "admin" || src === "owner")) {
      fields.push({ field, current: curVal, proposed, source: src, status: "blocked_by_curation" });
      blockedCount++;
      continue;
    }
    fields.push({ field, current: curVal, proposed, source: src, status: "changed" });
    changedCount++;
  }
  return { fields, changedCount, blockedCount };
}

/**
 * Stable hash over the payload the admin has just previewed. If any input
 * changes (normalized rows, mapping resolution, protected settings) the
 * hash flips and the UI must force a re-preview.
 */
export function computePreviewHash(input: {
  items: Array<{
    placeId: string | null;
    intent: string;
    approved: string[];
    proposedFields: string[];
  }>;
  mappingsApproved: string[];
  settings: Record<string, unknown>;
}): string {
  const norm = {
    items: [...input.items].sort((a, b) =>
      (a.placeId ?? "").localeCompare(b.placeId ?? "") ||
      (a.intent).localeCompare(b.intent),
    ),
    mappingsApproved: [...input.mappingsApproved].sort(),
    settings: Object.keys(input.settings)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = input.settings[k];
        return acc;
      }, {}),
  };
  return sha256Hex(JSON.stringify(norm));
}
