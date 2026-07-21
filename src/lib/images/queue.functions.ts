/**
 * Image queue server functions (admin-only).
 *
 * Every mutation:
 *   - is admin-gated via requireAdmin middleware
 *   - is idempotent (Correction #7 partial unique index + upsert-on-conflict)
 *   - never enqueues invalid or already-uploaded rows (Correction #23)
 *
 * The worker runs separately (see src/routes/api/public/hooks/image-tick.ts).
 * These functions only enqueue and inspect state.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin.middleware";
import { checkAllowlist } from "@/lib/images/allowlist";
import { summarizeR2Config } from "@/lib/storage/env.server";

const idInput = z.object({ imageId: z.string().uuid() });

export const getImagePipelineStatus = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ count: total }, { count: pending }, { count: processing }, { count: failed }, { count: uploaded }] =
      await Promise.all([
        supabase.from("business_images").select("*", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("image_processing_jobs").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("image_processing_jobs").select("*", { count: "exact", head: true }).eq("status", "processing"),
        supabase.from("image_processing_jobs").select("*", { count: "exact", head: true }).eq("status", "failed"),
        supabase.from("business_images").select("*", { count: "exact", head: true }).eq("storage_status", "uploaded"),
      ]);
    return {
      r2: summarizeR2Config(),
      counts: { total: total ?? 0, pending: pending ?? 0, processing: processing ?? 0, failed: failed ?? 0, uploaded: uploaded ?? 0 },
    };
  });

export const listImageJobs = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((v) => z.object({
    status: z.enum(["pending","processing","retry","uploaded","failed","cancelled"]).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }).parse(v))
  .handler(async ({ context, data }) => {
    let q = context.supabase.from("image_processing_jobs").select("*").order("updated_at", { ascending: false }).limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

/**
 * Queue a single image (admin explicit action). Idempotent: if an active
 * job already exists for this image, returns it without creating a new one.
 */
export const queueImageJob = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) => idInput.parse(v))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: img, error: imgErr } = await supabase
      .from("business_images")
      .select("id, source_url, source_type, storage_status, deleted_at")
      .eq("id", data.imageId).single();
    if (imgErr) throw imgErr;
    if (img.deleted_at) return { ok: false as const, reason: "image_deleted" };
    if (img.storage_status === "uploaded") return { ok: false as const, reason: "already_uploaded" };
    if (img.source_type === "google_places" || img.source_type === "external_manual") {
      if (!img.source_url || !checkAllowlist(img.source_url).ok) {
        return { ok: false as const, reason: "invalid_source_url" };
      }
    }

    // Idempotent: check for existing active job.
    const { data: existing } = await supabase
      .from("image_processing_jobs")
      .select("*")
      .eq("business_image_id", data.imageId)
      .in("status", ["pending", "processing", "retry"])
      .maybeSingle();
    if (existing) return { ok: true as const, job: existing, created: false };

    const { data: job, error } = await supabase
      .from("image_processing_jobs")
      .insert({ business_image_id: data.imageId, status: "pending", requested_by: userId, next_run_at: new Date().toISOString() })
      .select("*").single();
    if (error) throw error;
    return { ok: true as const, job, created: true };
  });

export const cancelImageJob = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) => idInput.parse(v))
  .handler(async ({ context, data }) => {
    const { data: job, error } = await context.supabase
      .from("image_processing_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.imageId)
      .in("status", ["pending", "processing", "retry"])
      .select("*").maybeSingle();
    if (error) throw error;
    return { job };
  });

export const retryImageJob = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) => idInput.parse(v))
  .handler(async ({ context, data }) => {
    const { data: job, error } = await context.supabase
      .from("image_processing_jobs")
      .update({ status: "retry", next_run_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
      .eq("id", data.imageId)
      .in("status", ["failed", "cancelled"])
      .select("*").maybeSingle();
    if (error) throw error;
    return { job };
  });

/**
 * Import integration (Correction #23). Called after an import batch runs.
 * Idempotently enqueues any pending/failed images for the given business ids,
 * respecting allowlist and skipping already-uploaded rows.
 */
export const queueImagesAfterImport = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) => z.object({ businessIds: z.array(z.string().uuid()).min(1).max(500) }).parse(v))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: images, error } = await supabase
      .from("business_images")
      .select("id, source_url, source_type, storage_status")
      .in("business_id", data.businessIds)
      .in("storage_status", ["pending", "failed"])
      .is("deleted_at", null);
    if (error) throw error;

    let enqueued = 0, skipped = 0;
    for (const img of images ?? []) {
      if (img.source_type === "google_places" || img.source_type === "external_manual") {
        if (!img.source_url || !checkAllowlist(img.source_url).ok) { skipped++; continue; }
      }
      const { error: upErr } = await supabase.from("image_processing_jobs").upsert(
        { business_image_id: img.id, status: "pending", next_run_at: new Date().toISOString() },
        { onConflict: "business_image_id", ignoreDuplicates: true },
      );
      if (upErr) { skipped++; continue; }
      enqueued++;
    }
    return { enqueued, skipped, total: (images ?? []).length };
  });
