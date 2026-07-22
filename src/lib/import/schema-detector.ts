/**
 * Deterministic JSON schema detector for import batches.
 *
 * Walks an uploaded JSON payload recursively and produces a complete field
 * inventory keyed by dotted source path. Array elements are represented with
 * `[]` in the path (e.g. `reviews[].rating`).
 *
 * The detector never uses hard-coded normalizer paths as the source of truth
 * — it discovers whatever fields exist. Suggested target mappings are looked
 * up in a small dictionary and returned separately from the inventory so
 * unknown paths are still surfaced (marked "unsupported") for admin review.
 */
import { extractImportItems, unwrapRecord } from "./format";
import { sha256Hex } from "@/lib/utils/sha256";

export type DetectedType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "mixed";

export interface DetectedField {
  sourcePath: string;
  detectedType: DetectedType;
  sampleValues: unknown[];
  occurrenceCount: number;
  nullCount: number;
  missingCount: number;
  parentCount: number;
  nullMissingPct: number;
  confidence: number;
}

export interface DetectedSchema {
  totalItems: number;
  fields: DetectedField[];
  generatedAt: string;
}

export interface MappingRow {
  sourcePath: string;
  targetTable: string | null;
  targetColumn: string | null;
  transform: string | null;
  status: "mapped" | "ignored" | "unsupported" | "required_missing" | "store";
  required: boolean;
  reason: string | null;
}

// -------- suggested target dictionary --------
// Only known Google-Places-shaped paths get an auto-suggestion. Anything else
// is surfaced as `unsupported` and the admin decides.
interface Suggestion {
  targetTable: string;
  targetColumn: string;
  transform: string | null;
  required?: boolean;
}
const SUGGESTIONS: Record<string, Suggestion> = {
  // ----- businesses -----
  "place_id": { targetTable: "businesses", targetColumn: "place_id", transform: "identity", required: true },
  "placeId": { targetTable: "businesses", targetColumn: "place_id", transform: "identity", required: true },
  "business.placeId": { targetTable: "businesses", targetColumn: "place_id", transform: "identity", required: true },
  "business.place_id": { targetTable: "businesses", targetColumn: "place_id", transform: "identity", required: true },
  "name": { targetTable: "businesses", targetColumn: "name", transform: "trim", required: true },
  "business.name": { targetTable: "businesses", targetColumn: "name", transform: "trim", required: true },
  "formatted_address": { targetTable: "businesses", targetColumn: "formatted_address", transform: "trim" },
  "formattedAddress": { targetTable: "businesses", targetColumn: "formatted_address", transform: "trim" },
  "business.formattedAddress": { targetTable: "businesses", targetColumn: "formatted_address", transform: "trim" },
  "business.formatted_address": { targetTable: "businesses", targetColumn: "formatted_address", transform: "trim" },
  "geometry.location.lat": { targetTable: "businesses", targetColumn: "latitude", transform: "number" },
  "geometry.location.lng": { targetTable: "businesses", targetColumn: "longitude", transform: "number" },
  "business.latitude": { targetTable: "businesses", targetColumn: "latitude", transform: "number" },
  "business.longitude": { targetTable: "businesses", targetColumn: "longitude", transform: "number" },
  "phone": { targetTable: "businesses", targetColumn: "phone", transform: "normalizePhone" },
  "phoneNumber": { targetTable: "businesses", targetColumn: "phone", transform: "normalizePhone" },
  "business.phoneNumber": { targetTable: "businesses", targetColumn: "phone", transform: "normalizePhone" },
  "formatted_phone_number": { targetTable: "businesses", targetColumn: "phone", transform: "normalizePhone" },
  "international_phone_number": { targetTable: "businesses", targetColumn: "international_phone", transform: "normalizePhone" },
  "internationalPhoneNumber": { targetTable: "businesses", targetColumn: "international_phone", transform: "normalizePhone" },
  "website": { targetTable: "businesses", targetColumn: "website", transform: "url" },
  "business.website": { targetTable: "businesses", targetColumn: "website", transform: "url" },
  "url": { targetTable: "businesses", targetColumn: "google_maps_url", transform: "url" },
  "googleMapsUrl": { targetTable: "businesses", targetColumn: "google_maps_url", transform: "url" },
  "rating": { targetTable: "businesses", targetColumn: "rating", transform: "number" },
  "business.rating": { targetTable: "businesses", targetColumn: "rating", transform: "number" },
  "user_ratings_total": { targetTable: "businesses", targetColumn: "review_count", transform: "integer" },
  "userRatingsTotal": { targetTable: "businesses", targetColumn: "review_count", transform: "integer" },
  "business.userRatingsTotal": { targetTable: "businesses", targetColumn: "review_count", transform: "integer" },
  "price_level": { targetTable: "businesses", targetColumn: "price_level", transform: "integer" },
  "priceLevel": { targetTable: "businesses", targetColumn: "price_level", transform: "integer" },
  "business.priceLevel": { targetTable: "businesses", targetColumn: "price_level", transform: "integer" },
  "primary_category": { targetTable: "businesses", targetColumn: "primary_category_id", transform: "categoryLookup" },
  "primaryCategory": { targetTable: "businesses", targetColumn: "primary_category_id", transform: "categoryLookup" },
  "business.primaryCategory": { targetTable: "businesses", targetColumn: "primary_category_id", transform: "categoryLookup" },
  "types[]": { targetTable: "business_category_links", targetColumn: "category_id", transform: "categoryLookup" },
  "editorial_summary.overview": { targetTable: "businesses", targetColumn: "description", transform: "trim" },
  "editorialSummary.overview": { targetTable: "businesses", targetColumn: "description", transform: "trim" },
  "popular_times": { targetTable: "businesses", targetColumn: "popular_times", transform: "json" },
  "popularTimes": { targetTable: "businesses", targetColumn: "popular_times", transform: "json" },
  // ----- opening hours -----
  "opening_hours.periods[]": { targetTable: "business_opening_hours", targetColumn: "*", transform: "openingHours" },
  "openingHours.periods[]": { targetTable: "business_opening_hours", targetColumn: "*", transform: "openingHours" },
  "business.openingHours.periods[]": { targetTable: "business_opening_hours", targetColumn: "*", transform: "openingHours" },
  // ----- reviews[] -----
  "reviews[].author_name": { targetTable: "reviews", targetColumn: "author_name", transform: "trim" },
  "reviews[].authorName": { targetTable: "reviews", targetColumn: "author_name", transform: "trim" },
  "reviews[].rating": { targetTable: "reviews", targetColumn: "rating", transform: "number" },
  "reviews[].text": { targetTable: "reviews", targetColumn: "review_text", transform: "trim" },
  "reviews[].reviewText": { targetTable: "reviews", targetColumn: "review_text", transform: "trim" },
  "reviews[].language": { targetTable: "reviews", targetColumn: "review_language", transform: "identity" },
  "reviews[].time": { targetTable: "reviews", targetColumn: "review_date", transform: "epochSeconds" },
  "reviews[].profile_photo_url": { targetTable: "reviews", targetColumn: "author_avatar_url", transform: "url" },
  // ----- images[] / photos[] -----
  "photos[].photo_reference": { targetTable: "business_images", targetColumn: "source_metadata", transform: "photoReference" },
  "photos[].name": { targetTable: "business_images", targetColumn: "source_metadata", transform: "photoReference" },
  "photos[].width": { targetTable: "business_images", targetColumn: "width", transform: "integer" },
  "photos[].height": { targetTable: "business_images", targetColumn: "height", transform: "integer" },
  "images[].url": { targetTable: "business_images", targetColumn: "source_url", transform: "url" },
  "images[].image_url": { targetTable: "business_images", targetColumn: "source_url", transform: "url" },
  "images[].source": { targetTable: "business_images", targetColumn: "source_url", transform: "url" },
  "images[].width": { targetTable: "business_images", targetColumn: "width", transform: "integer" },
  "images[].height": { targetTable: "business_images", targetColumn: "height", transform: "integer" },
  "images[].categories[]": { targetTable: "business_images", targetColumn: "google_photo_labels", transform: "arrayOfString" },
};

/** Paths that MUST resolve to a target — admin cannot ignore them. */
const REQUIRED_SUGGESTIONS = new Set(
  Object.entries(SUGGESTIONS)
    .filter(([, s]) => s.required)
    .map(([k]) => k),
);

interface Accumulator {
  occurrence: number;
  nullCount: number;
  parentCount: number;
  samples: unknown[];
  types: Set<DetectedType>;
}

function typeOf(v: unknown): DetectedType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  return "mixed";
}

function walk(
  value: unknown,
  path: string,
  keysAtThisLevel: Set<string>,
  acc: Map<string, Accumulator>,
) {
  // Register this path.
  let a = acc.get(path);
  if (!a) {
    a = { occurrence: 0, nullCount: 0, parentCount: 0, samples: [], types: new Set() };
    acc.set(path, a);
  }
  a.occurrence++;
  const t = typeOf(value);
  a.types.add(t);
  if (t === "null") {
    a.nullCount++;
    return;
  }
  if (a.samples.length < 5 && t !== "object" && t !== "array") {
    a.samples.push(value);
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      keysAtThisLevel.add(`${path}.${k}`);
      walk(v, path ? `${path}.${k}` : k, keysAtThisLevel, acc);
    }
  } else if (t === "array") {
    const arr = value as unknown[];
    const childPath = `${path}[]`;
    for (const el of arr) {
      const subKeys = new Set<string>();
      walk(el, childPath, subKeys, acc);
    }
  }
}

export function detectSchema(payload: unknown): DetectedSchema {
  const items = extractImportItems(payload);
  const acc = new Map<string, Accumulator>();
  const perItemPaths: Set<string>[] = [];
  for (const raw of items) {
    const unwrapped = unwrapRecord(raw);
    const keys = new Set<string>();
    walk(unwrapped, "", keys, acc);
    perItemPaths.push(keys);
  }
  // Compute missingCount: for each field, count items where path is absent
  // (not merely null). We approximate parentCount as the total item count
  // for top-level paths, and as the parent's occurrence for nested paths.
  const fields: DetectedField[] = [];
  const totalItems = items.length;

  // Sort paths deterministically.
  const sortedPaths = Array.from(acc.keys()).filter((p) => p !== "").sort();

  for (const path of sortedPaths) {
    const a = acc.get(path)!;
    const isArrayChild = path.includes("[]");
    // parent path (without last segment)
    const lastDotIdx = Math.max(path.lastIndexOf("."), path.lastIndexOf("[]"));
    let parentCount = totalItems;
    if (lastDotIdx > 0) {
      const parent = path.endsWith("[]")
        ? path.slice(0, -2)
        : path.slice(0, lastDotIdx);
      const parentAcc = acc.get(parent);
      if (parentAcc) parentCount = parentAcc.occurrence;
    }
    const missingCount = isArrayChild
      ? 0 // arrays vary in length; treat "not-present-in-element" as missing per element
      : Math.max(0, parentCount - a.occurrence);
    const nullMissing = a.nullCount + missingCount;
    const nullMissingPct =
      parentCount > 0 ? Math.round((nullMissing / parentCount) * 1000) / 10 : 0;

    let detectedType: DetectedType = "mixed";
    const nonNullTypes = Array.from(a.types).filter((t) => t !== "null");
    if (nonNullTypes.length === 1) detectedType = nonNullTypes[0];
    else if (nonNullTypes.length === 0) detectedType = "null";

    const confidence =
      parentCount > 0 ? Math.round(((a.occurrence - a.nullCount) / parentCount) * 100) / 100 : 0;

    fields.push({
      sourcePath: path,
      detectedType,
      sampleValues: a.samples,
      occurrenceCount: a.occurrence,
      nullCount: a.nullCount,
      missingCount,
      parentCount,
      nullMissingPct,
      confidence,
    });
  }
  return { totalItems, fields, generatedAt: new Date().toISOString() };
}

export function suggestFieldMapping(schema: DetectedSchema): MappingRow[] {
  const rows: MappingRow[] = [];
  const seenRequired = new Set<string>();
  for (const f of schema.fields) {
    const s = SUGGESTIONS[f.sourcePath];
    if (s) {
      if (s.required) seenRequired.add(f.sourcePath);
      rows.push({
        sourcePath: f.sourcePath,
        targetTable: s.targetTable,
        targetColumn: s.targetColumn,
        transform: s.transform,
        status: "mapped",
        required: !!s.required,
        reason: null,
      });
    } else {
      // container fields (`opening_hours`, `reviews`, `photos`) are structural
      const isContainer =
        f.detectedType === "object" || f.detectedType === "array";
      rows.push({
        sourcePath: f.sourcePath,
        targetTable: null,
        targetColumn: null,
        transform: null,
        status: isContainer ? "store" : "unsupported",
        required: false,
        reason: isContainer ? "structural container" : "no target suggestion",
      });
    }
  }
  // Ensure required suggestions that failed to be discovered are flagged.
  for (const req of REQUIRED_SUGGESTIONS) {
    // Only flag one canonical variant if none of its variants appeared.
    const anyVariant = rows.some(
      (r) =>
        (r.targetTable === "businesses" && r.targetColumn === "place_id" &&
          r.status === "mapped"),
    );
    if (!anyVariant) {
      rows.push({
        sourcePath: req,
        targetTable: "businesses",
        targetColumn: "place_id",
        transform: "identity",
        status: "required_missing",
        required: true,
        reason: "required source path not found in file",
      });
      break; // one is enough
    }
  }
  return rows;
}

/** Stable canonical hash of the field-inventory (schema_hash). */
export function computeSchemaHash(schema: DetectedSchema): string {
  const canonical = schema.fields
    .map((f) => `${f.sourcePath}|${f.detectedType}`)
    .sort();
  return sha256Hex(JSON.stringify(canonical));
}

/** Stable canonical hash of the field-mapping (field_mapping_hash). */
export function computeFieldMappingHash(mapping: MappingRow[]): string {
  const canonical = [...mapping]
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
    .map((r) =>
      [
        r.sourcePath,
        r.targetTable ?? "",
        r.targetColumn ?? "",
        r.transform ?? "",
        r.status,
        r.required ? "1" : "0",
      ].join("|"),
    );
  return sha256Hex(JSON.stringify(canonical));
}

/** Merge admin edits (partial) with existing rows. Preserves order of `base`. */
export function applyMappingEdits(
  base: MappingRow[],
  edits: Array<Partial<MappingRow> & { sourcePath: string }>,
): MappingRow[] {
  const byPath = new Map(base.map((r) => [r.sourcePath, r]));
  for (const e of edits) {
    const cur = byPath.get(e.sourcePath);
    if (!cur) continue;
    const next: MappingRow = { ...cur, ...e };
    // Enforce: required rows cannot be marked ignored / unsupported.
    if (cur.required && (next.status === "ignored" || next.status === "unsupported")) {
      throw new Error(
        `Field ${e.sourcePath} is required by the importer and cannot be ignored.`,
      );
    }
    // Required rows must retain a target.
    if (cur.required && (!next.targetTable || !next.targetColumn)) {
      throw new Error(
        `Field ${e.sourcePath} is required and must have a target table + column.`,
      );
    }
    byPath.set(e.sourcePath, next);
  }
  return base.map((r) => byPath.get(r.sourcePath)!);
}

/** True when a suggested mapping row is required to run analysis. */
export function isRequiredMapping(row: MappingRow): boolean {
  return row.required;
}
