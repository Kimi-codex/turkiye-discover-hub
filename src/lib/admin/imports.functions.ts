/**
 * Admin JSON import wizard: upload → analyze → execute (chunked, resumable).
 *
 * Files are stored in the private `imports` storage bucket; only admins can
 * read/write. No base64 payload is ever sent over an RPC.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./require-admin.middleware";
import {
  detectImportFormat,
  extractImportItems,
} from "@/lib/import/format";
import {
  normalizeGooglePlace,
  validateNormalizedBusiness,
  type NormalizedBusiness,
} from "@/lib/import/normalize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const CHUNK_SIZE = 50;

/** Create an import batch row and return an upload token (signed URL). */
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
        source_format: "google_places",
        status: "uploading",
        file_name: data.fileName,
        file_size_bytes: data.fileSize,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Response(error.message, { status: 400 });

    const storagePath = `imports/${batch.id}/${data.fileName}`;
    const { data: signed, error: signErr } = await supabase.storage
      .from("imports")
      .createSignedUploadUrl(storagePath);
    if (signErr) throw new Response(signErr.message, { status: 500 });

    await supabase
      .from("import_batches")
      .update({ storage_path: storagePath })
      .eq("id", batch.id);

    return {
      batchId: batch.id as string,
      uploadUrl: signed.signedUrl as string,
      storagePath,
      token: signed.token as string,
    };
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
        .select("*")
        .eq("batch_id", data.id)
        .order("item_index", { ascending: true })
        .limit(500),
    ]);
    if (error) throw new Response(error.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    return { batch, items: items ?? [] };
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
    if (!batch.storage_path) throw new Response("Batch has no file", { status: 400 });

    await supabase
      .from("import_batches")
      .update({ status: "analyzing", analyze_started_at: new Date().toISOString() })
      .eq("id", data.id);

    const { data: blob, error: dlErr } = await supabase.storage
      .from("imports")
      .download(batch.storage_path);
    if (dlErr) {
      await supabase
        .from("import_batches")
        .update({ status: "failed", error_message: dlErr.message })
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
        .update({ status: "failed", error_message: `Invalid JSON: ${(e as Error).message}` })
        .eq("id", data.id);
      throw new Response("Invalid JSON", { status: 400 });
    }
    const format = detectImportFormat(payload);
    const items = extractImportItems(payload);

    // Wipe any previous items for this batch (in case of re-analysis)
    await supabase.from("import_batch_items").delete().eq("batch_id", data.id);

    // Build normalized rows and category suggestions
    const rows: Record<string, unknown>[] = [];
    const categorySuggestions = new Set<string>();
    let valid = 0;
    let invalid = 0;
    items.forEach((raw, idx) => {
      const normalized = normalizeGooglePlace(raw);
      const validation = validateNormalizedBusiness(normalized);
      if (normalized) {
        normalized.categoriesSource.forEach((c) => categorySuggestions.add(c));
        if (normalized.primaryCategorySource) categorySuggestions.add(normalized.primaryCategorySource);
      }
      if (validation.ok) valid++;
      else invalid++;
      rows.push({
        batch_id: data.id,
        item_index: idx,
        place_id: normalized?.placeId ?? null,
        action: normalized ? "pending" : "skipped",
        normalized_data: normalized as unknown,
        source_data: raw,
        errors: validation.errors,
        warnings: validation.warnings,
        status: normalized ? "pending" : "invalid",
      });
    });

    // Insert in chunks (avoid over-large single inserts)
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const { error: insErr } = await supabase.from("import_batch_items").insert(slice);
      if (insErr) throw new Response(insErr.message, { status: 500 });
    }

    // Register category mappings as pending for any unknown labels
    if (categorySuggestions.size > 0) {
      const labels = Array.from(categorySuggestions);
      const { data: existing } = await supabase
        .from("category_mappings")
        .select("source_category")
        .in("source_category", labels);
      const existingSet = new Set((existing ?? []).map((r: { source_category: string }) => r.source_category));
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
        status: "analyzed",
        analyze_completed_at: new Date().toISOString(),
        source_format: format,
        total_items: items.length,
        valid_items: valid,
        invalid_items: invalid,
      })
      .eq("id", data.id);

    return { ok: true, total: items.length, valid, invalid };
  });

/**
 * Run a single chunk of items. Idempotent: uses (batch_id, item_index) index
 * on import_batch_items and place_id upsert on businesses. Callers loop
 * until getImportBatch reports status='completed'.
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
    if (!["analyzed", "running", "paused"].includes(batch.status))
      throw new Response(`Batch is ${batch.status}, cannot run`, { status: 400 });

    // Load next chunk of pending items
    const { data: items } = await supabase
      .from("import_batch_items")
      .select("*")
      .eq("batch_id", data.id)
      .eq("status", "pending")
      .order("item_index")
      .limit(CHUNK_SIZE);

    if (!items || items.length === 0) {
      await supabase
        .from("import_batches")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", data.id);
      return { ok: true, processed: 0, done: true };
    }

    if (batch.status !== "running") {
      await supabase
        .from("import_batches")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", data.id);
    }

    // Load settings once
    const settingKeys = [
      "import.default_status",
      "import.preserve_curated_fields",
      "import.require_known_city",
      "import.require_category_mapping",
      "images.queue_after_import",
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

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of items) {
      const normalized = item.normalized_data as NormalizedBusiness | null;
      try {
        if (!normalized) {
          await markItem(supabase, item.id, "skipped", "invalid_normalized");
          skipped++;
          continue;
        }
        // Resolve city
        const cityId = await resolveCity(supabase, normalized.cityHint);
        if (requireKnownCity && !cityId) {
          await markItem(supabase, item.id, "skipped", "unknown_city");
          skipped++;
          continue;
        }
        // Resolve category
        const primaryCatId = normalized.primaryCategorySource
          ? mappingIndex.get(normalized.primaryCategorySource) ?? null
          : null;
        if (requireCategoryMapping && !primaryCatId) {
          await markItem(supabase, item.id, "skipped", "unmapped_category");
          skipped++;
          continue;
        }

        // Find existing business by place_id
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

        // Build patch honoring precedence: admin/owner curated fields stay
        const wanted: Record<string, unknown> = {
          name: normalized.name,
          description: normalized.description,
          formatted_address: normalized.formattedAddress,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          phone: normalized.phone,
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
          await markItem(supabase, item.id, "updated", null, businessId);
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
          created++;
          await markItem(supabase, item.id, "created", null, businessId);
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

        // Images: upsert by source_url; queue for R2 in Phase 4
        if (normalized.images.length > 0) {
          for (const img of normalized.images) {
            await supabase.from("business_images").upsert(
              {
                business_id: businessId,
                source_url: img.sourceUrl,
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
          }
        }

        // Reviews (Google source): upsert by source_fingerprint
        if (normalized.reviews.length > 0) {
          for (const r of normalized.reviews) {
            await supabase.from("reviews").upsert(
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
              { onConflict: "business_id,source_fingerprint" },
            );
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
        await markItem(supabase, item.id, "failed", (e as Error).message ?? "error");
      }
    }

    // Update batch counters
    await supabase.rpc("record_audit", {
      _action: "import.chunk",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: null,
      _metadata: { created, updated, skipped, failed, chunk_size: items.length },
    });

    const { data: remaining } = await supabase
      .from("import_batch_items")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", data.id)
      .eq("status", "pending");

    const done = !remaining || (remaining as unknown as { count?: number }).count === 0;
    if (done) {
      await supabase
        .from("import_batches")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", data.id);
    }

    return { ok: true, processed: items.length, created, updated, skipped, failed, done };
  });

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
  status: "created" | "updated" | "skipped" | "failed",
  reason: string | null,
  businessId?: string,
) {
  const patch: Record<string, unknown> = { status, action: status };
  if (reason) patch.error_message = reason;
  if (businessId) patch.business_id = businessId;
  patch.processed_at = new Date().toISOString();
  await supabase.from("import_batch_items").update(patch).eq("id", id);
}

async function resolveCity(supabase: Sb, hint: string | null): Promise<string | null> {
  if (!hint) return null;
  const normalized = hint.trim().toLowerCase();
  // Try translations first
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
