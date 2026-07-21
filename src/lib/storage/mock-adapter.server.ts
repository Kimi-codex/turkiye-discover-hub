/**
 * In-memory storage adapter for tests and for local development
 * before real R2 credentials are provisioned. Never used in production.
 */

import type { HeadObjectResult, PutObjectInput, PutObjectResult, StorageAdapter } from "./types";

interface Entry {
  body: Uint8Array;
  contentType: string;
  etag: string;
}

export class MockStorageAdapter implements StorageAdapter {
  readonly name = "mock";
  private store = new Map<string, Entry>();

  isConfigured(): boolean {
    return true;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const etag = `mock-${input.body.length}-${input.key.length}`;
    this.store.set(input.key, { body: input.body, contentType: input.contentType, etag });
    return {
      key: input.key,
      size: input.body.length,
      etag,
      publicUrl: `mock://${input.key}`,
    };
  }

  async head(key: string): Promise<HeadObjectResult> {
    const e = this.store.get(key);
    if (!e) return { exists: false };
    return { exists: true, size: e.body.length, contentType: e.contentType, etag: e.etag };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async urlFor(key: string): Promise<string> {
    return `mock://${key}`;
  }

  /** Test helper. */
  _dump() {
    return Array.from(this.store.entries()).map(([key, e]) => ({
      key,
      size: e.body.length,
      contentType: e.contentType,
    }));
  }
}
