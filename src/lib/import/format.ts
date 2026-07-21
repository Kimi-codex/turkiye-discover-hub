/**
 * Google Places / Google Maps JSON export formats vary. Detect the shape
 * of an uploaded document and extract the array of place records.
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
