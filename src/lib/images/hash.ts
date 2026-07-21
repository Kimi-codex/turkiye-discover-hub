/**
 * Content-hash + deterministic object-key helpers.
 * Uses Web Crypto (SubtleCrypto) — available in Node 18+, Workers, and Deno.
 */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return bufToHex(new Uint8Array(digest));
}

function bufToHex(u8: Uint8Array): string {
  let out = "";
  for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, "0");
  return out;
}

/**
 * Deterministic R2 key from businessId + content hash + extension.
 * Same content for same business → same key → safe idempotent PUT.
 *
 * Correction #9: multiple business_images rows MAY reference one R2 object.
 * Deletion must therefore check references before removing the R2 object.
 */
/**
 * Deterministic R2 key.
 *
 * Canonical format (approved for Phase 4/5):
 *   businesses/{business_id}/{sanitized_place_id}/{sha256}.{ext}
 *
 * `sanitized_place_id` is the source place_id lowercased and non-alphanumeric
 * chars replaced with `-`. Owner uploads on businesses without a Google
 * place_id use `owner-{uploader_id}` as the segment (business_images.place_id
 * is NOT NULL, so callers always have something to pass in).
 *
 * Same content for same business+place → same key → safe idempotent PUT.
 *
 * Correction #9: multiple business_images rows MAY reference one R2 object.
 * Deletion must therefore check references before removing the R2 object.
 */
export function buildImageKey(params: {
  businessId: string;
  placeId: string;
  contentHash: string;
  ext: "webp" | "jpg" | "png";
}): string {
  const safePlace = sanitizePlaceId(params.placeId);
  return `businesses/${params.businessId}/${safePlace}/${params.contentHash}.${params.ext}`;
}

export function sanitizePlaceId(placeId: string): string {
  const cleaned = placeId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : "unknown";
}
