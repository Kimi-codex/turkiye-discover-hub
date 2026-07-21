/**
 * Image normalization pipeline STRUCTURE.
 *
 * A real deployment adds a WASM WebP encoder (e.g. `@jsquash/webp`) to
 * re-encode and to correct EXIF orientation. Until that runtime spike has
 * been performed with real R2 credentials and the deployed Edge runtime,
 * this module does NOT re-encode. It passes through the original bytes and
 * carries the sniffed content type so PUTs still succeed.
 *
 * When the WASM encoder is enabled it MUST:
 *   - decode the JPEG/PNG/WebP fully
 *   - respect EXIF orientation (verify against a fixture with orientation != 1)
 *   - re-encode to WebP at a configured quality
 *   - populate width/height from the DECODED image (post-rotation)
 *
 * Correction #11: EXIF orientation is NOT claimed as corrected until a real
 * JPEG fixture with orientation != 1 verifies final width/height/visual.
 */

import { sniffImageType, type SniffedType } from "./magic-bytes";
import { sha256Hex } from "./hash";

export interface NormalizedImage {
  bytes: Uint8Array;
  contentType: SniffedType;
  contentHash: string;
  /** Width/height are unknown until a real decoder is wired up. */
  width?: number;
  height?: number;
  /** true once WASM re-encoding + EXIF correction is enabled. */
  reencoded: boolean;
  ext: "webp" | "jpg" | "png";
}

export async function normalizeImage(bytes: Uint8Array): Promise<NormalizedImage> {
  const contentType = sniffImageType(bytes);
  if (contentType === "unknown") throw new Error("normalizeImage: unsupported content");

  // Pass-through path (pre-runtime-spike). See file header.
  const ext: NormalizedImage["ext"] =
    contentType === "image/webp" ? "webp" : contentType === "image/png" ? "png" : "jpg";
  const contentHash = await sha256Hex(bytes);
  return {
    bytes,
    contentType,
    contentHash,
    reencoded: false,
    ext,
  };
}
