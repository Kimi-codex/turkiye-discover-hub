/**
 * Image queue server functions (admin-only).
 *
 * Two disjoint concepts must NOT be mixed in the UI:
 *   - records: rows in `business_images` (source references)
 *   - jobs:    rows in `image_processing_jobs` (worker state)
 * The status endpoint returns them in separate blocks with disjoint labels
 * so the admin UI can never render a single ambiguous "Total" number.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin.middleware";
import { checkAllowlist } from "@/lib/images/allowlist";
import { summarizeR2Config } from "@/lib/storage/env.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const idInput = z.object({ imageId: z.string().uuid() });
const idsInput = z.object({ imageIds: z.array(z.string().uuid()).min(1).max(200) });

async function countHead(sb: Sb, table: string, filters: Array<[string, unknown]>): Promise<number> {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of filters) {
    if (val === null) q = q.is(col, null);
    else q = q.eq(col, val);
  }
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export const getImagePipelineStatus = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const sb = context.supabase as Sb;

    const [
      recTotal,
      recWithSrc,
      recMissingSrc,
      recWithR2,
      byExternalOnly,
      byPending,
      byProcessing,
      byUploaded,
      byFailed,
      bySkipped,
      bySrcGoogle,
      bySrcExternalManual,
      bySrcOwner,
      jobsTotal,
      jobsPending,
      jobsProcessing,
      jobsRetry,
      jobsUploaded,
      jobsFailed,
      jobsCancelled,
    ] = await Promise.all([
      countHead(sb, "business_images", [["deleted_at", null]]),
      // has_source_url: source_url IS NOT NULL → we implement via .not
      (async () => {
        const { count, error } = await sb
          .from("business_images")
          .select("*", { count: "exact", head: true })
          .not("source_url", "is", null)
          .is("deleted_at", null);
        if (error) throw error;
        return count ?? 0;
      })(),
      (async () => {
        const { count, error } = await sb
          .from("business_images")
          .select("*", { count: "exact", head: true })
          .is("source_url", null)
          .is("deleted_at", null);
        if (error) throw error;
        return count ?? 0;
      })(),
      (async () => {
        const { count, error } = await sb
          .from("business_images")
          .select("*", { count: "exact", head: true })
          .not("r2_key", "is", null)
          .is("deleted_at", null);
        if (error) throw error;
        return count ?? 0;
      })(),
      countHead(sb, "business_images", [["storage_status", "external_only"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["storage_status", "pending"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["storage_status", "processing"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["storage_status", "uploaded"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["storage_status", "failed"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["storage_status", "skipped"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["source_type", "google_places"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["source_type", "external_manual"], ["deleted_at", null]]),
      countHead(sb, "business_images", [["source_type", "owner_upload"], ["deleted_at", null]]),
      countHead(sb, "image_processing_jobs", []),
      countHead(sb, "image_processing_jobs", [["status", "pending"]]),
      countHead(sb, "image_processing_jobs", [["status", "processing"]]),
      countHead(sb, "image_processing_jobs", [["status", "retry"]]),
      countHead(sb, "image_processing_jobs", [["status", "uploaded"]]),
      countHead(sb, "image_processing_jobs", [["status", "failed"]]),
      countHead(sb, "image_processing_jobs", [["status", "cancelled"]]),
    ]);

    return {
      r2: summarizeR2Config(),
      records: {
        total: recTotal,
        with_source_url: recWithSrc,
        missing_source_url: recMissingSrc,
        with_r2_key: recWithR2,
        by_storage_status: {
          external_only: byExternalOnly,
          pending: byPending,
          processing: byProcessing,
          uploaded: byUploaded,
          failed: byFailed,
          skipped: bySkipped,
        },
        by_source_type: {
          google_places: bySrcGoogle,
          external_manual: bySrcExternalManual,
          owner_upload: bySrcOwner,
        },
      },
      jobs: {
        total: jobsTotal,
        queued: jobsPending + jobsRetry,
        pending: jobsPending,
        retry: jobsRetry,
        processing: jobsProcessing,
        uploaded: jobsUploaded,
        failed: jobsFailed,
        cancelled: jobsCancelled,
      },
    };
  });

export const listImageJobs = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((v) =>
    z
      .object({
        status: z
          .enum(["pending", "processing", "retry", "uploaded", "failed", "cancelled"])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(v),
  )
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("image_processing_jobs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

/**
 * Records tab data source: business_images joined to businesses (name, source).
 * Import batch attribution is derived via import_batch_items → same business_id,
 * which is best-effort (multi-import scenarios pick the most recent).
 */
export const listImageRecords = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((v) =>
    z
      .object({
        storageStatus: z
          .enum(["external_only", "pending", "processing", "uploaded", "failed", "skipped"])
          .optional(),
        sourceType: z.enum(["google_places", "external_manual", "owner_upload"]).optional(),
        hasSourceUrl: z.enum(["yes", "no"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(v),
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as Sb;
    let q = sb
      .from("business_images")
      .select(
        "id, business_id, place_id, source_url, source_metadata, source_fingerprint, r2_key, storage_status, source_type, source_provider, created_at, is_cover, businesses(name, source)",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.storageStatus) q = q.eq("storage_status", data.storageStatus);
    if (data.sourceType) q = q.eq("source_type", data.sourceType);
    if (data.hasSourceUrl === "yes") q = q.not("source_url", "is", null);
    if (data.hasSourceUrl === "no") q = q.is("source_url", null);
    const { data: rows, error } = await q;
    if (error) throw error;

    const bizIds = Array.from(new Set((rows ?? []).map((r: { business_id: string }) => r.business_id)));
    const batchByBiz = new Map<string, string>();
    if (bizIds.length > 0) {
      const { data: items } = await sb
        .from("import_batch_items")
        .select("business_id, import_batch_id, processed_at")
        .in("business_id", bizIds)
        .order("processed_at", { ascending: false });
      for (const it of items ?? []) {
        if (!batchByBiz.has(it.business_id)) batchByBiz.set(it.business_id, it.import_batch_id);
      }
    }
    return (rows ?? []).map(
      (r: {
        id: string;
        business_id: string;
        place_id: string;
        source_url: string | null;
        source_metadata: unknown;
        source_fingerprint: string | null;
        r2_key: string | null;
        storage_status: string;
        source_type: string;
        source_provider: string | null;
        created_at: string;
        is_cover: boolean;
        businesses: { name: string; source: string } | null;
      }) => ({
        ...r,
        business_name: r.businesses?.name ?? "—",
        business_source: r.businesses?.source ?? "—",
        import_batch_id: batchByBiz.get(r.business_id) ?? null,
      }),
    );
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
      .eq("id", data.imageId)
      .single();
    if (imgErr) throw imgErr;
    if (img.deleted_at) return { ok: false as const, reason: "image_deleted" };
    if (img.storage_status === "uploaded") return { ok: false as const, reason: "already_uploaded" };
    if (img.source_type === "google_places" || img.source_type === "external_manual") {
      if (!img.source_url || !checkAllowlist(img.source_url).ok) {
        return { ok: false as const, reason: "invalid_source_url" };
      }
    }

    const { data: existing } = await supabase
      .from("image_processing_jobs")
      .select("*")
      .eq("business_image_id", data.imageId)
      .in("status", ["pending", "processing", "retry"])
      .maybeSingle();
    if (existing) return { ok: true as const, job: existing, created: false };

    const { data: job, error } = await supabase
      .from("image_processing_jobs")
      .insert({
        business_image_id: data.imageId,
        status: "pending",
        requested_by: userId,
        next_run_at: new Date().toISOString(),
      })
      .select("*")
      .single();
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
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return { job };
  });

export const retryImageJob = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) => idInput.parse(v))
  .handler(async ({ context, data }) => {
    const { data: job, error } = await context.supabase
      .from("image_processing_jobs")
      .update({
        status: "retry",
        next_run_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.imageId)
      .in("status", ["failed", "cancelled"])
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return { job };
  });

async function softDeleteImageRecords(sb: Sb, imageIds: string[]) {
  const now = new Date().toISOString();

  const { error: jobsError } = await sb
    .from("image_processing_jobs")
    .update({ status: "cancelled", updated_at: now })
    .in("business_image_id", imageIds)
    .in("status", ["pending", "processing", "retry"]);
  if (jobsError) throw jobsError;

  const { data: images, error: imagesError } = await sb
    .from("business_images")
    .update({ deleted_at: now, is_cover: false, updated_at: now })
    .in("id", imageIds)
    .is("deleted_at", null)
    .select("id");
  if (imagesError) throw imagesError;

  return images ?? [];
}

export const deleteImageRecord = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) => idInput.parse(v))
  .handler(async ({ context, data }) => {
    const deleted = await softDeleteImageRecords(context.supabase as Sb, [data.imageId]);
    return { ok: true as const, deleted: deleted.length };
  });

export const deleteImageRecords = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) => idsInput.parse(v))
  .handler(async ({ context, data }) => {
    const deleted = await softDeleteImageRecords(context.supabase as Sb, data.imageIds);
    return { ok: true as const, deleted: deleted.length };
  });

export const queueImagesAfterImport = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((v) =>
    z.object({ businessIds: z.array(z.string().uuid()).min(1).max(500) }).parse(v),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: images, error } = await supabase
      .from("business_images")
      .select("id, source_url, source_type, storage_status")
      .in("business_id", data.businessIds)
      .in("storage_status", ["pending", "failed"])
      .is("deleted_at", null);
    if (error) throw error;

    let enqueued = 0,
      skipped = 0;
    for (const img of images ?? []) {
      if (img.source_type === "google_places" || img.source_type === "external_manual") {
        if (!img.source_url || !checkAllowlist(img.source_url).ok) {
          skipped++;
          continue;
        }
      }
      const { error: upErr } = await supabase.from("image_processing_jobs").upsert(
        { business_image_id: img.id, status: "pending", next_run_at: new Date().toISOString() },
        { onConflict: "business_image_id", ignoreDuplicates: true },
      );
      if (upErr) {
        skipped++;
        continue;
      }
      enqueued++;
    }
    return { enqueued, skipped, total: (images ?? []).length };
  });
