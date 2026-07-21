/**
 * Cloudflare R2 adapter using AWS Signature V4 via `aws4fetch`.
 * Runtime-neutral: works in Node, Cloudflare Workers, and Deno Edge Functions.
 *
 * NOTE: This file only *shapes* the calls. Real network requests will only be
 * attempted once R2 credentials are provided. Until then `isConfigured()`
 * returns false and every operation throws a typed configuration error.
 */

import type { HeadObjectResult, PutObjectInput, PutObjectResult, StorageAdapter } from "./types";
import { readR2Config, type R2Config } from "./env.server";

export class R2ConfigurationError extends Error {
  code = "R2_NOT_CONFIGURED" as const;
  constructor(public missing: string[]) {
    super(`R2 not configured; missing: ${missing.join(", ")}`);
  }
}

/**
 * Lazy-loaded R2 adapter. aws4fetch is imported dynamically so the client
 * bundle never touches it.
 */
export class R2StorageAdapter implements StorageAdapter {
  readonly name = "r2";
  private cfg: R2Config | null;
  private clientPromise: Promise<{ fetch: typeof fetch }> | null = null;

  constructor(cfg: R2Config | null) {
    this.cfg = cfg;
  }

  isConfigured(): boolean {
    return this.cfg !== null;
  }

  private requireCfg(): R2Config {
    if (!this.cfg) throw new R2ConfigurationError(["R2 credentials"]);
    return this.cfg;
  }

  private async getClient(): Promise<{ fetch: typeof fetch }> {
    const cfg = this.requireCfg();
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { AwsClient } = (await import("aws4fetch")) as typeof import("aws4fetch");
        const client = new AwsClient({
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          service: "s3",
          region: "auto",
        });
        return { fetch: client.fetch.bind(client) as typeof fetch };
      })();
    }
    return this.clientPromise;
  }

  private urlForKey(key: string): string {
    const cfg = this.requireCfg();
    return `${cfg.endpoint}/${cfg.bucket}/${encodeURI(key)}`;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const cfg = this.requireCfg();
    const client = await this.getClient();
    const res = await client.fetch(this.urlForKey(input.key), {
      method: "PUT",
      body: input.body as unknown as BodyInit,
      headers: {
        "Content-Type": input.contentType,
        "Cache-Control": input.cacheControl ?? "public, max-age=31536000, immutable",
        ...(input.metadata
          ? Object.fromEntries(Object.entries(input.metadata).map(([k, v]) => [`x-amz-meta-${k}`, v]))
          : {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`R2 PUT failed ${res.status}: ${text.slice(0, 200)}`);
    }
    return {
      key: input.key,
      size: input.body.length,
      etag: res.headers.get("etag") ?? undefined,
      publicUrl: cfg.accessMode === "public" && cfg.publicBaseUrl
        ? `${cfg.publicBaseUrl}/${input.key}`
        : undefined,
    };
  }

  async head(key: string): Promise<HeadObjectResult> {
    const client = await this.getClient();
    const res = await client.fetch(this.urlForKey(key), { method: "HEAD" });
    if (res.status === 404) return { exists: false };
    if (!res.ok) throw new Error(`R2 HEAD failed ${res.status}`);
    return {
      exists: true,
      size: Number(res.headers.get("content-length") ?? 0) || undefined,
      contentType: res.headers.get("content-type") ?? undefined,
      etag: res.headers.get("etag") ?? undefined,
    };
  }

  async delete(key: string): Promise<void> {
    const client = await this.getClient();
    const res = await client.fetch(this.urlForKey(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed ${res.status}`);
  }

  async urlFor(key: string, opts?: { expiresInSeconds?: number }): Promise<string> {
    const cfg = this.requireCfg();
    if (cfg.accessMode === "public") {
      if (!cfg.publicBaseUrl) throw new Error("R2 public mode requires R2_PUBLIC_URL");
      return `${cfg.publicBaseUrl}/${key}`;
    }
    // Private mode: presigned GET URL via aws4fetch's sign().
    const client = (await import("aws4fetch")) as typeof import("aws4fetch");
    const aws = new client.AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    const expires = opts?.expiresInSeconds ?? 300;
    const url = new URL(this.urlForKey(key));
    url.searchParams.set("X-Amz-Expires", String(expires));
    const signed = await aws.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
    return signed.url;
  }
}

/** Factory: returns real R2 when configured, otherwise a mock-safe stub. */
export function getStorageAdapter(): StorageAdapter {
  const cfg = readR2Config();
  if (cfg.configured) return new R2StorageAdapter(cfg);
  return new R2StorageAdapter(null); // isConfigured() === false
}
