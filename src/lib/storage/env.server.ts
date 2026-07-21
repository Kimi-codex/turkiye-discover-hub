/**
 * R2 environment validation. Server-only.
 *
 * When any required secret is missing we return `{ configured: false }` and
 * the entire pipeline degrades safely:
 *   - queue accepts jobs but the worker returns a clear configuration error
 *   - failed configuration jobs do NOT increment retry (see worker code)
 *   - admin UI shows "Not configured"
 *   - image URLs fall back to source_url or placeholder
 */

export type R2AccessMode = "public" | "private";

export interface R2Config {
  configured: true;
  accessMode: R2AccessMode;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  /** Only present in public mode. Base URL such as https://images.example.com. */
  publicBaseUrl?: string;
}

export interface R2Missing {
  configured: false;
  missing: string[];
}

export type R2ConfigResult = R2Config | R2Missing;

const REQUIRED: string[] = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
];

export function readR2Config(): R2ConfigResult {
  const env = process.env as Record<string, string | undefined>;
  const missing = REQUIRED.filter((name) => !env[name] || env[name]!.length === 0);

  // Public mode also needs R2_PUBLIC_URL (permanent URLs stored server-side).
  const accessMode: R2AccessMode = env.R2_ACCESS_MODE === "private" ? "private" : "public";
  if (accessMode === "public" && !env.R2_PUBLIC_URL) missing.push("R2_PUBLIC_URL");

  if (missing.length > 0) return { configured: false, missing };

  return {
    configured: true,
    accessMode,
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET_NAME!,
    endpoint: env.R2_ENDPOINT!.replace(/\/+$/, ""),
    publicBaseUrl: env.R2_PUBLIC_URL?.replace(/\/+$/, ""),
  };
}

/** Public helper used by admin UI to show configuration status. */
export function summarizeR2Config(): { configured: boolean; missing: string[]; accessMode: R2AccessMode } {
  const r = readR2Config();
  if (r.configured) return { configured: true, missing: [], accessMode: r.accessMode };
  return { configured: false, missing: r.missing, accessMode: (process.env.R2_ACCESS_MODE === "private" ? "private" : "public") };
}

export function readImageWorkerSecret(): string | null {
  return process.env.IMAGE_WORKER_SECRET ?? null;
}
