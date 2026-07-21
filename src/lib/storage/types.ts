/**
 * Runtime-neutral storage abstraction shared by:
 *   - server functions (TanStack, Node/Worker)
 *   - the Deno-compatible image-processing worker (future)
 *   - unit tests (mock adapter)
 *
 * MUST NOT import Node-only or Bun-only APIs.
 */

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  size: number;
  etag?: string;
  /** Permanent URL when the bucket is public; undefined for private buckets. */
  publicUrl?: string;
}

export interface HeadObjectResult {
  exists: boolean;
  size?: number;
  contentType?: string;
  etag?: string;
}

export interface StorageAdapter {
  readonly name: string;
  isConfigured(): boolean;
  put(input: PutObjectInput): Promise<PutObjectResult>;
  head(key: string): Promise<HeadObjectResult>;
  delete(key: string): Promise<void>;
  /** Returns a permanent URL (public buckets) or a short-lived signed URL (private). */
  urlFor(key: string, opts?: { expiresInSeconds?: number }): Promise<string>;
}
