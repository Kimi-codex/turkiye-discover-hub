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
export function buildImageKey(params: {
  businessId: string;
  contentHash: string;
  ext: "webp" | "jpg" | "png";
  size?: "orig" | "1600" | "800" | "400";
}): string {
  const size = params.size ?? "orig";
  const prefix = params.contentHash.slice(0, 2);
  return `businesses/${params.businessId}/${size}/${prefix}/${params.contentHash}.${params.ext}`;
}
