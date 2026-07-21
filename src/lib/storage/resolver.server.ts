/**
 * Server-side URL resolver used by SSR / server functions to render a
 * business_images row into the final public URL.
 *
 * Rules:
 *   - When R2 is configured and the row is `uploaded` with `r2_url`, use it.
 *   - Otherwise fall back to `source_url` when safe.
 *   - Never invent a URL. Callers use `getBusinessImageUrl` (client-safe)
 *     for the placeholder fallback.
 *
 * Private-mode resolution intentionally lives here (Correction #5): the
 * client MUST NOT generate signed URLs. When we switch to private R2, this
 * resolver becomes an async signer or points to a server proxy route.
 */

import type { BusinessImage } from "@/types/domain";
import { getBusinessImageUrl } from "@/lib/images/storage";
import { readR2Config } from "./env.server";

export function resolvePublicImageUrl(image: BusinessImage | null | undefined): string {
  const cfg = readR2Config();
  if (image && cfg.configured && cfg.accessMode === "public") {
    if (image.storageStatus === "uploaded" && image.r2Url) return image.r2Url;
  }
  return getBusinessImageUrl(image);
}
