/**
 * Admin JSON import wizard: upload → analyze → execute (chunked, resumable).
 *
 * Files are stored in the private `imports` storage bucket; only admins can
 * read/write. No base64 payload is ever sent over an RPC.
 *
 * Column names, statuses, and actions here match the LIVE database schema:
 *
 *   import_batches
 *     source, source_provider, status, original_filename, file_size,
 *     storage_bucket, storage_object_path, total_items, valid_items,
 *     invalid_items, inserted_items, updated_items, duplicate_items,
 *     skipped_items, needs_mapping_items, processed_items, failed_items,
 *     started_at, completed_at, error_message, created_by
 *   Statuses: pending | uploaded | analyzing | ready | importing |
 *             completed | partially_completed | failed | cancelled
 *
 *   import_batch_items
 *     import_batch_id, item_index, place_id, status, action,
 *     error_message, raw_payload (source+normalized+errors+warnings),
 *     business_id, processed_at
 *   Statuses: pending | processing | inserted | updated | duplicate |
 *             skipped | invalid | needs_mapping | failed
 *   Actions:  insert | update | skip | duplicate | invalid | needs_mapping
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./require-admin.middleware";
import {
  detectImportFormat,
  extractImportItems,
  unwrapRecord,
} from "@/lib/import/format";
import {
  normalizeGooglePlace,
  validateNormalizedBusiness,
  type NormalizedBusiness,
} from "@/lib/import/normalize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const CHUNK_SIZE = 50;
const IMPORTS_BUCKET = "imports";

/** Create an import batch row first, THEN return a signed upload URL. */
export const createImportBatch = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { fileName: string; fileSize: number; contentType: string }) => {
    if (!i?.fileName) throw new Response("Missing fileName", { status: 400 });
    if (typeof i.fileSize !== "number" || i.fileSize <= 0)
      throw new Response("Invalid fileSize", { status: 400 });
    if (i.fileSize > 200 * 1024 * 1024)
      throw new Response("File exceeds 200MB limit", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch, error } = await supabase
      .from("import_batches")
      .insert({
        source: "google_places",
        source_provider: "google",
        status: "pending",
        original_filename: data.fileName,
        file_size: data.fileSize,
        created_by: context.userId,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Response(error.message, { status: 400 });

    const storagePath = `${batch.id}/${data.fileName}`;
    const { data: signed, error: signErr } = await supabase.storage
      .from(IMPORTS_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signErr) {
      // Preserve the batch row; mark it failed with the reason.
      await supabase
        .from("import_batches")
        .update({
          status: "failed",
          error_message: `signed_url_failed: ${signErr.message}`,
        })
        .eq("id", batch.id);
      throw new Response(signErr.message, { status: 500 });
    }

    await supabase
      .from("import_batches")
      .update({
        storage_bucket: IMPORTS_BUCKET,
        storage_object_path: storagePath,
      })
      .eq("id", batch.id);

    return {
      batchId: batch.id as string,
      uploadUrl: signed.signedUrl as string,
      storagePath,
      bucket: IMPORTS_BUCKET,
      token: signed.token as string,
    };
  });

/** Mark a pre-created batch as `uploaded` once the browser confirms PUT succeeded. */
export const markImportBatchUploaded = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { error } = await supabase
      .from("import_batches")
      .update({ status: "uploaded", error_message: null })
      .eq("id", data.id)
      .in("status", ["pending", "failed"]);
    if (error) throw new Response(error.message, { status: 400 });
    return { ok: true };
  });

/** Mark a batch as failed with a safe step + message. Preserves the row. */
export const markImportBatchFailed = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string; step: string; message: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return {
      id: i.id,
      step: String(i.step ?? "unknown").slice(0, 40),
      message: String(i.message ?? "").slice(0, 500),
    };
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { error } = await supabase
      .from("import_batches")
      .update({
        status: "failed",
        error_message: `${data.step}: ${data.message}`,
      })
      .eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    return { ok: true };
  });

export const listImportBatches = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Sb;
    const { data, error } = await supabase
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: data ?? [] };
  });

export const getImportBatch = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const [{ data: batch, error }, { data: items }] = await Promise.all([
      supabase.from("import_batches").select("*").eq("id", data.id).maybeSingle(),
      supabase
        .from("import_batch_items")
        .select("id, item_index, place_id, status, action, error_message, business_id, processed_at, raw_payload")
        .eq("import_batch_id", data.id)
        .order("item_index", { ascending: true })
        .limit(500),
    ]);
    if (error) throw new Response(error.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });

    // Check storage object existence (defensive; ignore errors).
    let storageExists = false;
    if (batch.storage_object_path) {
      try {
        const parts = String(batch.storage_object_path).split("/");
        const filename = parts.pop() as string;
        const prefix = parts.join("/");
        const { data: list } = await supabase.storage
          .from(batch.storage_bucket ?? IMPORTS_BUCKET)
          .list(prefix, { search: filename, limit: 1 });
        storageExists = !!(list && list.length > 0);
      } catch {
        storageExists = false;
      }
    }
    return { batch, items: items ?? [], storageExists };
  });

/** Download the uploaded file, parse, normalize items into batch_items. */
export const analyzeImportBatch = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch, error } = await supabase
      .from("import_batches")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    if (!batch.storage_object_path) throw new Response("Batch has no file", { status: 400 });

    await supabase
      .from("import_batches")
      .update({ status: "analyzing", error_message: null })
      .eq("id", data.id);

    const bucket = batch.storage_bucket ?? IMPORTS_BUCKET;
    const { data: blob, error: dlErr } = await supabase.storage
      .from(bucket)
      .download(batch.storage_object_path);
    if (dlErr) {
      await supabase
        .from("import_batches")
        .update({ status: "failed", error_message: `download_failed: ${dlErr.message}` })
        .eq("id", data.id);
      throw new Response(dlErr.message, { status: 500 });
    }

    const text = await blob.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      await supabase
        .from("import_batches")
        .update({ status: "failed", error_message: `invalid_json: ${(e as Error).message}` })
        .eq("id", data.id);
      throw new Response("Invalid JSON", { status: 400 });
    }
    const format = detectImportFormat(payload);
    const rawItems = extractImportItems(payload);

    // Wipe any previous items for this batch (in case of re-analysis)
    await supabase.from("import_batch_items").delete().eq("import_batch_id", data.id);

    const rows: Record<string, unknown>[] = [];
    const categorySuggestions = new Set<string>();
    let valid = 0;
    let invalid = 0;
    rawItems.forEach((rawRecord, idx) => {
      const unwrapped = unwrapRecord(rawRecord);
      const normalized = normalizeGooglePlace(unwrapped);
      const validation = validateNormalizedBusiness(normalized);
      if (normalized) {
        normalized.categoriesSource.forEach((c) => categorySuggestions.add(c));
        if (normalized.primaryCategorySource) categorySuggestions.add(normalized.primaryCategorySource);
      }
      const isValid = validation.ok;
      if (isValid) valid++;
      else invalid++;
      rows.push({
        import_batch_id: data.id,
        item_index: idx,
        place_id: normalized?.placeId ?? null,
        status: isValid ? "pending" : "invalid",
        action: isValid ? null : "invalid",
        error_message: isValid ? null : (validation.errors[0] ?? "invalid"),
        raw_payload: {
          source: rawRecord,
          normalized: normalized as unknown,
          errors: validation.errors,
          warnings: validation.warnings,
        },
      });
    });

    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const { error: insErr } = await supabase.from("import_batch_items").insert(slice);
      if (insErr) {
        await supabase
          .from("import_batches")
          .update({ status: "failed", error_message: `items_insert_failed: ${insErr.message}` })
          .eq("id", data.id);
        throw new Response(insErr.message, { status: 500 });
      }
    }

    // Register category mappings as pending for any unknown labels
    if (categorySuggestions.size > 0) {
      const labels = Array.from(categorySuggestions);
      const { data: existing } = await supabase
        .from("category_mappings")
        .select("source_category")
        .in("source_category", labels);
      const existingSet = new Set(
        (existing ?? []).map((r: { source_category: string }) => r.source_category),
      );
      const inserts = labels
        .filter((l) => !existingSet.has(l))
        .map((l) => ({
          source_provider: "google",
          source_category: l,
          normalized_source_category: l.toLowerCase().trim(),
          mapping_status: "pending",
          usage_count: 1,
        }));
      if (inserts.length > 0) {
        await supabase.from("category_mappings").insert(inserts);
      }
    }

    await supabase
      .from("import_batches")
      .update({
        status: "ready",
        source: format,
        total_items: rawItems.length,
        valid_items: valid,
        invalid_items: invalid,
        error_message: null,
      })
      .eq("id", data.id);

    return { ok: true, total: rawItems.length, valid, invalid, format };
  });

/**
 * Run a single chunk of items. Idempotent: UPSERT businesses by place_id.
 * Callers loop until getImportBatch reports status='completed' or 'partially_completed'.
 */
export const runImportChunk = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (!["ready", "importing"].includes(batch.status))
      throw new Response(`Batch is ${batch.status}, cannot run`, { status: 400 });

    // Load next chunk of pending items
    const { data: items } = await supabase
      .from("import_batch_items")
      .select("*")
      .eq("import_batch_id", data.id)
      .eq("status", "pending")
      .order("item_index")
      .limit(CHUNK_SIZE);

    if (!items || items.length === 0) {
      await finalizeBatch(supabase, data.id);
      return { ok: true, processed: 0, done: true };
    }

    if (batch.status !== "importing") {
      await supabase
        .from("import_batches")
        .update({ status: "importing", started_at: batch.started_at ?? new Date().toISOString() })
        .eq("id", data.id);
    }

    // Load settings once
    const settingKeys = [
      "import.default_status",
      "import.preserve_curated_fields",
      "import.require_known_city",
      "import.require_category_mapping",
    ];
    const { data: settingRows } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", settingKeys);
    const settings = Object.fromEntries(
      (settingRows ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]),
    ) as Record<string, unknown>;
    const defaultStatus = (settings["import.default_status"] as string) ?? "pending_review";
    const preserveCurated = settings["import.preserve_curated_fields"] !== false;
    const requireKnownCity = settings["import.require_known_city"] === true;
    const requireCategoryMapping = settings["import.require_category_mapping"] === true;

    // Preload approved category mappings
    const { data: mappings } = await supabase
      .from("category_mappings")
      .select("source_category, category_id, mapping_status")
      .eq("source_provider", "google")
      .eq("mapping_status", "approved");
    const mappingIndex = new Map<string, string>();
    (mappings ?? []).forEach((m: { source_category: string; category_id: string }) => {
      mappingIndex.set(m.source_category, m.category_id);
    });

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let reviewsWritten = 0;
    let imagesWritten = 0;
    const touchedBusinessIds = new Set<string>();

    for (const item of items) {
      const rp = (item.raw_payload as Record<string, unknown> | null) ?? {};
      const normalized = (rp.normalized as NormalizedBusiness | null) ?? null;
      try {
        if (!normalized) {
          await markItem(supabase, item.id, "skipped", "skip", "invalid_normalized");
          skipped++;
          continue;
        }
        const cityId = await resolveCity(supabase, normalized.cityHint);
        if (requireKnownCity && !cityId) {
          await markItem(supabase, item.id, "skipped", "skip", "unknown_city");
          skipped++;
          continue;
        }
        const primaryCatId = normalized.primaryCategorySource
          ? mappingIndex.get(normalized.primaryCategorySource) ?? null
          : null;
        if (requireCategoryMapping && !primaryCatId) {
          await markItem(supabase, item.id, "skipped", "skip", "unmapped_category");
          skipped++;
          continue;
        }

        // UPSERT identity strictly by place_id
        const { data: existing } = await supabase
          .from("businesses")
          .select("id, name, slug, field_sources, status")
          .eq("place_id", normalized.placeId)
          .maybeSingle();

        const slug = existing?.slug ?? slugify(normalized.name, normalized.placeId);
        const nowIso = new Date().toISOString();
        const fieldSources = ((existing?.field_sources as Record<string, unknown>) ?? {}) as Record<
          string,
          { source: string; updated_at: string }
        >;

        const wanted: Record<string, unknown> = {
          name: normalized.name,
          description: normalized.description,
          formatted_address: normalized.formattedAddress,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          phone: normalized.phone,
          international_phone: normalized.internationalPhone,
          website: normalized.website,
          google_maps_url: normalized.googleMapsUrl,
          rating: normalized.rating,
          review_count: normalized.reviewCount,
          price_level: normalized.priceLevel,
          city_id: cityId,
          primary_category_id: primaryCatId,
          popular_times: normalized.popularTimes as unknown,
          raw_data: normalized.raw as unknown,
          source: "google_places_import",
          place_id: normalized.placeId,
          slug,
        };
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(wanted)) {
          const src = fieldSources[k]?.source;
          if (preserveCurated && (src === "admin" || src === "owner")) continue;
          patch[k] = v;
          fieldSources[k] = { source: "import", updated_at: nowIso };
        }

        let businessId: string;
        if (existing) {
          patch.field_sources = fieldSources;
          const { error: uErr } = await supabase
            .from("businesses")
            .update(patch)
            .eq("id", existing.id);
          if (uErr) throw uErr;
          businessId = existing.id;
          updated++;
          await markItem(supabase, item.id, "updated", "update", null, businessId);
        } else {
          patch.field_sources = fieldSources;
          patch.status = defaultStatus;
          const { data: ins, error: iErr } = await supabase
            .from("businesses")
            .insert(patch)
            .select("id")
            .single();
          if (iErr) throw iErr;
          businessId = ins.id;
          inserted++;
          await markItem(supabase, item.id, "inserted", "insert", null, businessId);
        }

        // Opening hours: replace
        if (normalized.openingHours.length > 0) {
          await supabase.from("business_opening_hours").delete().eq("business_id", businessId);
          const hoursRows = normalized.openingHours.map((h) => ({
            business_id: businessId,
            day_of_week: h.dayOfWeek,
            open_time: h.openTime,
            close_time: h.closeTime,
            is_closed: h.isClosed,
          }));
          await supabase.from("business_opening_hours").insert(hoursRows);
        }

        // Images: upsert by (business_id, source_url) — Google source URL only.
        // storage_status stays 'pending' until the R2 worker (Blocked by
        // configuration) processes them. BusinessImage falls back to source_url.
        if (normalized.images.length > 0) {
          for (const img of normalized.images) {
            const { error: imgErr } = await supabase.from("business_images").upsert(
              {
                business_id: businessId,
                source_url: img.sourceUrl,
                source_provider: "google",
                source_type: "google_places",
                sort_order: img.sortOrder,
                is_cover: img.isCover,
                google_photo_category: img.googleCategory,
                google_photo_labels: img.googleLabels ?? [],
                storage_status: "pending",
                width: img.width ?? null,
                height: img.height ?? null,
                image_type: img.isCover ? "cover" : "gallery",
              },
              { onConflict: "business_id,source_url" },
            );
            if (!imgErr) imagesWritten++;
          }
        }

        // Reviews (Google source): upsert by source_fingerprint
        if (normalized.reviews.length > 0) {
          for (const r of normalized.reviews) {
            const { error: revErr } = await supabase.from("reviews").upsert(
              {
                business_id: businessId,
                source: "google",
                source_fingerprint: r.sourceFingerprint,
                external_review_id: r.externalReviewId,
                author_name: r.authorName,
                author_avatar_url: r.authorAvatarUrl,
                rating: r.rating,
                review_text: r.reviewText,
                review_language: r.reviewLanguage,
                review_date: r.reviewDate,
                status: "published",
              },
              { onConflict: "business_id,source,source_fingerprint" },
            );
            if (!revErr) reviewsWritten++;
          }
        }

        // Category links: preserve primary + additional
        const catIds = Array.from(
          new Set(
            [primaryCatId, ...normalized.categoriesSource.map((c) => mappingIndex.get(c) ?? null)].filter(
              (x): x is string => !!x,
            ),
          ),
        );
        if (catIds.length > 0) {
          await supabase.from("business_category_links").delete().eq("business_id", businessId);
          const links = catIds.map((cid) => ({
            business_id: businessId,
            category_id: cid,
            is_primary: cid === primaryCatId,
          }));
          await supabase.from("business_category_links").insert(links);
        }
      } catch (e) {
        failed++;
        await markItem(supabase, item.id, "failed", null, (e as Error).message?.slice(0, 400) ?? "error");
      }
    }

    // Increment counters on the batch row
    await supabase.rpc("record_audit", {
      _action: "import.chunk",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: null,
      _metadata: { inserted, updated, skipped, failed, chunk_size: items.length },
    });

    // Update counters (fetch current, add delta — no dedicated RPC to increment)
    const { data: cur } = await supabase
      .from("import_batches")
      .select("inserted_items, updated_items, skipped_items, failed_items, processed_items")
      .eq("id", data.id)
      .maybeSingle();
    await supabase
      .from("import_batches")
      .update({
        inserted_items: (cur?.inserted_items ?? 0) + inserted,
        updated_items: (cur?.updated_items ?? 0) + updated,
        skipped_items: (cur?.skipped_items ?? 0) + skipped,
        failed_items: (cur?.failed_items ?? 0) + failed,
        processed_items: (cur?.processed_items ?? 0) + items.length,
      })
      .eq("id", data.id);

    const { count: remaining } = await supabase
      .from("import_batch_items")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", data.id)
      .eq("status", "pending");

    const done = !remaining || remaining === 0;
    if (done) await finalizeBatch(supabase, data.id);

    return {
      ok: true,
      processed: items.length,
      inserted,
      updated,
      skipped,
      failed,
      reviewsWritten,
      imagesWritten,
      done,
    };
  });

async function finalizeBatch(supabase: Sb, id: string) {
  const { data: b } = await supabase
    .from("import_batches")
    .select("failed_items, invalid_items, inserted_items, updated_items")
    .eq("id", id)
    .maybeSingle();
  const anyFailure = (b?.failed_items ?? 0) > 0 || (b?.invalid_items ?? 0) > 0;
  const anySuccess = (b?.inserted_items ?? 0) > 0 || (b?.updated_items ?? 0) > 0;
  const finalStatus = anyFailure && anySuccess ? "partially_completed" : anyFailure && !anySuccess ? "failed" : "completed";
  await supabase
    .from("import_batches")
    .update({ status: finalStatus, completed_at: new Date().toISOString() })
    .eq("id", id);
}

export const cancelImportBatch = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { error } = await supabase
      .from("import_batches")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await supabase.rpc("record_audit", {
      _action: "import.cancel",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: { status: "cancelled" },
      _metadata: {},
    });
    return { ok: true };
  });

async function markItem(
  supabase: Sb,
  id: string,
  status: "inserted" | "updated" | "skipped" | "failed" | "invalid" | "duplicate" | "needs_mapping",
  action: "insert" | "update" | "skip" | "duplicate" | "invalid" | "needs_mapping" | null,
  reason: string | null,
  businessId?: string,
) {
  const patch: Record<string, unknown> = { status };
  if (action) patch.action = action;
  if (reason) patch.error_message = reason;
  if (businessId) patch.business_id = businessId;
  patch.processed_at = new Date().toISOString();
  await supabase.from("import_batch_items").update(patch).eq("id", id);
}

async function resolveCity(supabase: Sb, hint: string | null): Promise<string | null> {
  if (!hint) return null;
  const normalized = hint.trim().toLowerCase();
  const { data: t } = await supabase
    .from("city_translations")
    .select("city_id, name")
    .ilike("name", normalized)
    .limit(1);
  if (t && t.length > 0) return t[0].city_id;
  const { data: s } = await supabase
    .from("cities")
    .select("id, slug")
    .ilike("slug", normalized)
    .limit(1);
  if (s && s.length > 0) return s[0].id;
  return null;
}

function slugify(name: string, placeId: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const tail = placeId.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, "");
  return base ? `${base}-${tail}` : tail;
}
