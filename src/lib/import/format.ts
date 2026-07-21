/**
 * Google Places / Google Maps JSON export formats vary. Detect the shape
 * of an uploaded document and extract the array of place records.
 *
 * Supports these shapes, in this order:
 *   - array (root JSON array)                       → format "array"
 *   - { places: [...] }                             → "places"
 *   - { results: [...] }                            → "results"
 *   - { data: { results: [...] } }                  → "data.results"
 * Each item may be a raw Google place object OR the nested export shape
 * `{ business, reviews, images }`. Unwrapping is done in the normalizer,
 * not here — this module only extracts the array of records.
 */
export type ImportFormat =
  | "array"
  | "places"
  | "results"
  | "data.results"
  | "unknown";

export function detectImportFormat(payload: unknown): ImportFormat {
  if (Array.isArray(payload)) return "array";
  if (!payload || typeof payload !== "object") return "unknown";
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.places)) return "places";
  if (Array.isArray(p.results)) return "results";
  const data = p.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.results)) return "data.results";
  return "unknown";
}

export function extractImportItems(payload: unknown): Record<string, unknown>[] {
  const fmt = detectImportFormat(payload);
  if (fmt === "array") return (payload as Record<string, unknown>[]).filter(isObj);
  if (fmt === "places")
    return ((payload as Record<string, unknown>).places as unknown[]).filter(isObj) as Record<
      string,
      unknown
    >[];
  if (fmt === "results")
    return ((payload as Record<string, unknown>).results as unknown[]).filter(isObj) as Record<
      string,
      unknown
    >[];
  if (fmt === "data.results")
    return (((payload as Record<string, unknown>).data as Record<string, unknown>)
      .results as unknown[]).filter(isObj) as Record<string, unknown>[];
  return [];
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Normalize a record to a flat Google-place-shaped object.
 *
 * Handles two variants seen in real exports:
 *   1. Flat Google place: { place_id, name, photos, reviews, ... }
 *   2. Nested export:     { business: {...}, reviews: [...], images: [...] }
 *
 * Also maps common camelCase aliases (placeId, googleMapsUrl, reviewCount,
 * priceLevel, openingHours, formattedAddress) to their snake_case equivalents
 * so the downstream normalizer can stay stable.
 *
 * `business.placeId` (or `place_id`) remains the only mandatory identifier
 * and is checked by the normalizer.
 */
export function unwrapRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw.business as Record<string, unknown> | undefined;
  const base: Record<string, unknown> = nested && isObj(nested) ? { ...nested } : { ...raw };

  // Merge nested reviews / images into the base object so the normalizer
  // sees them at the top level (Google's flat shape).
  const nestedReviews = raw.reviews;
  if (!("reviews" in base) && Array.isArray(nestedReviews)) base.reviews = nestedReviews;
  const nestedImages = raw.images ?? raw.photos;
  if (!("photos" in base) && Array.isArray(nestedImages)) base.photos = nestedImages;

  // Alias mapping. Never overwrite an existing snake_case value.
  const aliases: Array<[string, string]> = [
    ["placeId", "place_id"],
    ["googleMapsUrl", "google_maps_url"],
    ["reviewCount", "user_ratings_total"],
    ["userRatingsTotal", "user_ratings_total"],
    ["priceLevel", "price_level"],
    ["openingHours", "opening_hours"],
    ["formattedAddress", "formatted_address"],
    ["internationalPhoneNumber", "international_phone_number"],
    ["formattedPhoneNumber", "formatted_phone_number"],
    ["phoneNumber", "formatted_phone_number"],
    ["addressComponents", "address_components"],
    ["editorialSummary", "editorial_summary"],
    ["popularTimes", "popular_times"],
    ["primaryCategory", "primary_category"],
  ];
  for (const [camel, snake] of aliases) {
    if (camel in base && !(snake in base)) base[snake] = base[camel];
  }
  return base;
}
