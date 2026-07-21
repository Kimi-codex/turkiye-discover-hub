/**
 * Image worker tick endpoint.
 *
 * Public (edge-auth bypassed) but PROTECTED by service-role apikey.
 * Scheduler design A (per user decision):
 *   pg_cron → net.http_post(url, headers=[apikey: <service_role from vault>])
 * The Data API forwards the apikey to PostgREST; we verify the JWT role here.
 *
 * NEVER inline the service-role key in cron SQL. It is stored in vault and
 * pg_cron reads it via a wrapper function at call time (documented in
 * docs/IMAGE_WORKER.md).
 *
 * Correction #6: exactly one accepted credential (service-role JWT).
 * Correction #24: when R2 is not configured, we return a configuration
 * error and DO NOT increment retry counts.
 */

import { createFileRoute } from "@tanstack/react-router";
import { readR2Config } from "@/lib/storage/env.server";
import { R2StorageAdapter } from "@/lib/storage/r2-adapter.server";
import { downloadImage } from "@/lib/images/download";
import { normalizeImage } from "@/lib/images/normalize-pipeline";
import { buildImageKey } from "@/lib/images/hash";

const CLAIM_LIMIT = 5;
const LEASE_SECONDS = 300;

export const Route = createFileRoute("/api/public/hooks/image-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. AuthN — expect service role JWT via `apikey` OR Authorization: Bearer.
        const apikey = request.headers.get("apikey") ?? request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
        const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceRole || !apikey || apikey !== serviceRole) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401, headers: { "content-type": "application/json" },
          });
        }

        // 2. Configuration guard. When R2 is missing, no work is attempted
        // and jobs are NOT marked failed (Correction #24).
        const cfg = readR2Config();
        if (!cfg.configured) {
          return Response.json({
            ok: false,
            configured: false,
            missing: cfg.missing,
            claimed: 0,
            note: "R2 not configured — worker is a no-op until secrets are provided.",
          }, { status: 200 });
        }

        // 3. Reap stale leases first (idempotent), then claim a batch.
        const { createClient } = await import("@supabase/supabase-js");
        const admin = createClient(process.env.SUPABASE_URL!, serviceRole, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        await admin.rpc("reap_stale_image_jobs");
        const { data: jobs, error: claimErr } = await admin.rpc("claim_next_image_jobs", {
          _worker: `worker-${crypto.randomUUID().slice(0, 8)}`,
          _limit: CLAIM_LIMIT,
          _lease_seconds: LEASE_SECONDS,
        });
        if (claimErr) return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 });

        const results: Array<{ jobId: string; status: string; detail?: string }> = [];
        const adapter = new R2StorageAdapter(cfg);

        for (const job of jobs ?? []) {
          const r = await processJob(admin, adapter, job);
          results.push(r);
        }

        return Response.json({ ok: true, configured: true, claimed: (jobs ?? []).length, results });
      },
    },
  },
});

type SbAdmin = Awaited<ReturnType<typeof getAdminType>>;
async function getAdminType() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient("", "");
}

async function processJob(admin: SbAdmin, adapter: R2StorageAdapter, job: {
  id: string; business_image_id: string; attempt: number; max_attempts: number;
}): Promise<{ jobId: string; status: string; detail?: string }> {
  const { data: img, error: imgErr } = await admin
    .from("business_images")
    .select("id, business_id, place_id, source_url, source_type, storage_status")
    .eq("id", job.business_image_id).single();
  if (imgErr || !img) return failJob(admin, job, "IMAGE_NOT_FOUND", imgErr?.message);
  if (img.storage_status === "uploaded") return succeed(admin, job, { note: "already uploaded" });

  // Only google/external sources supported by the download path (owner uploads use a different flow).
  if (img.source_type !== "google_places" && img.source_type !== "external_manual") {
    return failJob(admin, job, "SOURCE_NOT_SUPPORTED", "worker only handles remote URL sources");
  }
  if (!img.source_url) return failJob(admin, job, "MISSING_SOURCE_URL");

  const dl = await downloadImage(img.source_url);
  if (!dl.ok) return failJob(admin, job, dl.code, dl.detail);

  const normalized = await normalizeImage(dl.bytes);
  const key = buildImageKey({
    businessId: img.business_id,
    placeId: (img as { place_id?: string | null }).place_id ?? "unknown",
    contentHash: normalized.contentHash,
    ext: normalized.ext,
  });

  const put = await adapter.put({
    key,
    body: normalized.bytes,
    contentType: normalized.contentType,
  });

  // Update image row atomically.
  const { error: updErr } = await admin.from("business_images").update({
    r2_key: key,
    r2_url: put.publicUrl ?? null,
    content_hash: normalized.contentHash,
    content_type: normalized.contentType,
    file_size: normalized.bytes.length,
    width: normalized.width ?? null,
    height: normalized.height ?? null,
    storage_status: "uploaded",
    uploaded_at: new Date().toISOString(),
    error_code: null,
    error_message: null,
  }).eq("id", img.id);
  if (updErr) return failJob(admin, job, "DB_UPDATE_FAILED", updErr.message);

  return succeed(admin, job);
}

async function succeed(admin: SbAdmin, job: { id: string }, extra?: { note?: string }) {
  await admin.from("image_processing_jobs").update({
    status: "uploaded",
    last_error: null,
    last_error_code: null,
    metadata: extra ?? {},
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  return { jobId: job.id, status: "uploaded", detail: extra?.note };
}

async function failJob(admin: SbAdmin, job: { id: string; attempt: number; max_attempts: number }, code: string, detail?: string) {
  const isTerminal = job.attempt >= job.max_attempts;
  const nextRunAt = new Date(Date.now() + Math.min(60_000 * 2 ** job.attempt, 30 * 60_000)).toISOString();
  await admin.from("image_processing_jobs").update({
    status: isTerminal ? "failed" : "retry",
    last_error: detail ?? null,
    last_error_code: code,
    next_run_at: nextRunAt,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  await admin.from("business_images").update({
    storage_status: isTerminal ? "failed" : "pending",
    error_code: code,
    error_message: detail ?? null,
    last_attempt_at: new Date().toISOString(),
    next_attempt_at: nextRunAt,
    retry_count: job.attempt,
  }).eq("id", job.id);
  return { jobId: job.id, status: isTerminal ? "failed" : "retry", detail: `${code}${detail ? `: ${detail}` : ""}` };
}
