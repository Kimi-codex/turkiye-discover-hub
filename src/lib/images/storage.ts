import type { BusinessImage } from "@/types/domain";
import { BUSINESS_IMAGE_PLACEHOLDER } from "@/lib/assets/placeholder";

/**
 * ImageStorageProvider is the shared abstraction over image storage.
 * Phase 1 ships a demo/external provider. Phase 4 adds a Cloudflare R2
 * provider that implements the same interface without changing callers.
 */
export type StorageMode = "external_only" | "r2" | "fallback";

export interface ImageStorageProvider {
  readonly mode: StorageMode;
  /** Returns the URL the frontend should render for an image row. */
  getUrl(image: BusinessImage): string;
  /** True when the provider is fully configured. False signals "not configured yet". */
  isConfigured(): boolean;
}

class ExternalOnlyImageStorageProvider implements ImageStorageProvider {
  readonly mode: StorageMode = "external_only";
  isConfigured(): boolean {
    // The external-only mode is always usable — no credentials needed.
    return true;
  }
  getUrl(image: BusinessImage): string {
    return getBusinessImageUrl(image);
  }
}

/**
 * getBusinessImageUrl — SINGLE source of truth for the fallback chain.
 *
 * Priority:
 *   1. R2 uploaded URL (only when storage_status === "uploaded" and r2Url is present)
 *   2. valid source URL (http/https)
 *   3. local SVG placeholder
 *
 * Every business card and gallery MUST use this helper. Do not duplicate
 * this logic anywhere else.
 */
export function getBusinessImageUrl(image: BusinessImage | null | undefined): string {
  if (!image) return BUSINESS_IMAGE_PLACEHOLDER;

  if (image.storageStatus === "uploaded" && image.r2Url && isSafeHttpUrl(image.r2Url)) {
    return image.r2Url;
  }

  if (image.sourceUrl && isSafeHttpUrl(image.sourceUrl)) {
    return image.sourceUrl;
  }

  return BUSINESS_IMAGE_PLACEHOLDER;
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** The active provider for the running app (Phase 1: external-only). */
export const imageStorage: ImageStorageProvider = new ExternalOnlyImageStorageProvider();
