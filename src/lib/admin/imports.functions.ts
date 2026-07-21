/**
 * Admin JSON import wizard, v2 — schema-driven, 10-stage linear workflow.
 *
 * Stages: upload → analyze → mapping → validation → preview → execute →
 *         translations → images → publish → completed
 *
 * Three-state model for existing businesses:
 *   - current_snapshot: what's in the DB right now (per import_batch_items row)
 *   - proposed_diff:    what the importer wants to change (field-level)
 *   - approved_fields:  which of those fields the admin authorized to write
 *
 * Inserts of never-seen place_ids always apply the full normalized record.
 * Updates of known place_ids write ONLY fields listed in approved_fields
 * whose current field_sources.source is neither "admin" nor "owner".
 *
 * Imported businesses land as `pending_review` and require an explicit
 * `publishImportBatch` call before they become publicly visible.
 *
 * The importer is schema-driven and deterministic. Nothing here special-cases
 * any particular file, fixture, or place_id.
 */
import { createServerFn } from "@tanstack/react-start";
import { createHash } from "crypto";
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
import {
  computeProposedDiff,
  computePreviewHash,
  IMPORTABLE_FIELDS,
  type ImportableField,
} from "@/lib/import/preview";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const CHUNK_SIZE = 50;
const IMPORTS_BUCKET = "imports";

/** Terminal stages that block destructive actions like delete. */
const EXECUTED_STAGES = new Set(["execute", "translations", "images", "publish", "completed"]);

// ---------- Stage helpers ----------

async function advanceStage(
  supabase: Sb,
  id: string,
  stage: string,
  patch: Record<string, unknown> = {},
) {
  const nowIso = new Date().toISOString();
  const { data: b } = await supabase
    .from("import_batches")
    .select("stage, stage_history")
    .eq("id", id)
    .maybeSingle();
  const history = Array.isArray(b?.stage_history) ? (b.stage_history as unknown[]) : [];
  const entry = { at: nowIso, from: b?.stage ?? null, to: stage };
  const nextHistory = [...history, entry].slice(-50);
  await supabase
    .from("import_batches")
    .update({ stage, stage_history: nextHistory, ...patch })
    .eq("id", id);
}

// ---------- Create + upload ----------

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
        stage: "upload",
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
    await advanceStage(supabase, data.id, "detect_schema");
    return { ok: true };
  });

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

// ---------- List / detail ----------

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
    const [{ data: batch, error }, { data: items }, { data: provenance }] = await Promise.all([
      supabase.from("import_batches").select("*").eq("id", data.id).maybeSingle(),
      supabase
        .from("import_batch_items")
        .select("id, item_index, place_id, status, action, intent, error_message, business_id, processed_at, raw_payload, current_snapshot, proposed_diff, approved_fields, preview_hash")
        .eq("import_batch_id", data.id)
        .order("item_index", { ascending: true })
        .limit(1000),
      supabase
        .from("business_import_provenance")
        .select("business_id, applied_action, applied_fields, applied_at")
        .eq("import_batch_id", data.id)
        .limit(1000),
    ]);
    if (error) throw new Response(error.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });

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

    // Discovered category mappings for this batch.
    const catLabels = new Set<string>();
    (items ?? []).forEach((it: Record<string, unknown>) => {
      const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
      const normalized = rp.normalized as NormalizedBusiness | null;
      if (normalized) {
        normalized.categoriesSource.forEach((c) => catLabels.add(c));
        if (normalized.primaryCategorySource) catLabels.add(normalized.primaryCategorySource);
      }
    });
    type MappingRow = { source_category: string; category_id: string | null; mapping_status: string };
    let mappingRows: MappingRow[] = [];
    if (catLabels.size > 0) {
      const { data: m } = await supabase
        .from("category_mappings")
        .select("source_category, category_id, mapping_status")
        .eq("source_provider", "google")
        .in("source_category", Array.from(catLabels));
      mappingRows = (m ?? []) as MappingRow[];
    }

    return {
      batch,
      items: items ?? [],
      provenance: provenance ?? [],
      mappings: mappingRows,
      storageExists,
    };
  });

// ---------- Analyze ----------

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
    const fileHash = createHash("sha256").update(text).digest("hex");
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

    // Clean previous items and provenance for re-analysis.
    await supabase.from("import_batch_items").delete().eq("import_batch_id", data.id);

    // Collect all place_ids for a single existing-lookup query.
    const normalizedItems: Array<{ raw: Record<string, unknown>; n: NormalizedBusiness | null; idx: number }> = [];
    rawItems.forEach((rawRecord, idx) => {
      const unwrapped = unwrapRecord(rawRecord);
      normalizedItems.push({ raw: rawRecord, n: normalizeGooglePlace(unwrapped), idx });
    });
    const placeIds = normalizedItems
      .map((x) => x.n?.placeId)
      .filter((x): x is string => !!x);
    let existingByPlaceId = new Map<string, Record<string, unknown>>();
    if (placeIds.length > 0) {
      const { data: exs } = await supabase
        .from("businesses")
        .select(`id, place_id, status, field_sources, ${IMPORTABLE_FIELDS.join(", ")}`)
        .in("place_id", placeIds);
      (exs ?? []).forEach((r: Record<string, unknown>) => {
        existingByPlaceId.set(String(r.place_id), r);
      });
    }

    const rows: Record<string, unknown>[] = [];
    const categorySuggestions = new Set<string>();
    let valid = 0;
    let invalid = 0;
    for (const { raw, n, idx } of normalizedItems) {
      const validation = validateNormalizedBusiness(n);
      const isValid = validation.ok && n !== null;
      if (n) {
        n.categoriesSource.forEach((c) => categorySuggestions.add(c));
        if (n.primaryCategorySource) categorySuggestions.add(n.primaryCategorySource);
      }
      let intent: string = isValid ? "insert" : "invalid";
      let currentSnapshot: Record<string, unknown> | null = null;
      let proposedDiff: unknown = null;
      if (isValid && n) {
        const existing = existingByPlaceId.get(n.placeId) ?? null;
        if (existing) {
          intent = "update";
          currentSnapshot = existing;
          const diff = computeProposedDiff(
            n,
            existing,
            (existing.field_sources as Record<string, { source?: string; updated_at?: string }>) ?? null,
          );
          proposedDiff = diff;
          if (diff.changedCount === 0) intent = "noop";
        }
      }
      if (isValid) valid++; else invalid++;
      rows.push({
        import_batch_id: data.id,
        item_index: idx,
        place_id: n?.placeId ?? null,
        status: isValid ? "pending" : "invalid",
        action: isValid ? null : "invalid",
        intent,
        error_message: isValid ? null : (validation.errors[0] ?? "invalid"),
        current_snapshot: currentSnapshot,
        proposed_diff: proposedDiff,
        approved_fields: [],
        raw_payload: {
          source: raw,
          normalized: n,
          errors: validation.errors,
          warnings: validation.warnings,
        },
      });
    }

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

    // Register unmapped category labels as pending.
    if (categorySuggestions.size > 0) {
      const labels = Array.from(categorySuggestions);
      const { data: existingMappings } = await supabase
        .from("category_mappings")
        .select("source_category")
        .in("source_category", labels);
      const existingSet = new Set(
        (existingMappings ?? []).map((r: { source_category: string }) => r.source_category),
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
        source: "google_places",
        total_items: rawItems.length,
        valid_items: valid,
        invalid_items: invalid,
        file_hash: fileHash,
        error_message: null,
        preview_hash: null,      // any prior preview is invalidated
        previewed_at: null,
        mapping_confirmed_at: null,
      })
      .eq("id", data.id);
    await advanceStage(supabase, data.id, "mapping", { metadata: { format } });

    return { ok: true, total: rawItems.length, valid, invalid, format };
  });

// ---------- Mapping confirmation ----------

export const confirmImportMappings = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("stage")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (batch.stage !== "mapping" && batch.stage !== "validation")
      throw new Response(`Cannot confirm mappings in stage ${batch.stage}`, { status: 400 });

    // Collect labels this batch touches.
    const { data: items } = await supabase
      .from("import_batch_items")
      .select("raw_payload")
      .eq("import_batch_id", data.id);
    const labels = new Set<string>();
    (items ?? []).forEach((it: Record<string, unknown>) => {
      const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
      const n = rp.normalized as NormalizedBusiness | null;
      if (n) {
        n.categoriesSource.forEach((c) => labels.add(c));
        if (n.primaryCategorySource) labels.add(n.primaryCategorySource);
      }
    });
    // Report what's still pending; do NOT auto-approve.
    let pending = 0;
    let approved = 0;
    if (labels.size > 0) {
      const { data: rows } = await supabase
        .from("category_mappings")
        .select("source_category, mapping_status, category_id")
        .in("source_category", Array.from(labels))
        .eq("source_provider", "google");
      (rows ?? []).forEach((r: { mapping_status: string; category_id: string | null }) => {
        if (r.mapping_status === "approved" && r.category_id) approved++;
        else pending++;
      });
    }
    await advanceStage(supabase, data.id, "validation", { preview_hash: null, previewed_at: null, mapping_confirmed_at: new Date().toISOString() });
    return { ok: true, approvedMappings: approved, pendingMappings: pending };
  });

// ---------- Preview ----------

export const computeImportPreview = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("stage")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (!["mapping", "validation", "preview"].includes(batch.stage))
      throw new Response(`Cannot preview in stage ${batch.stage}`, { status: 400 });

    // Re-hydrate current snapshot for update items, since businesses may have
    // been edited since analyze. This is what protects against stale previews.
    const { data: items } = await supabase
      .from("import_batch_items")
      .select("id, place_id, intent, raw_payload")
      .eq("import_batch_id", data.id)
      .in("status", ["pending"])
      .order("item_index");
    const placeIds = (items ?? [])
      .map((it: Record<string, unknown>) => it.place_id as string | null)
      .filter((x: string | null): x is string => !!x);
    const existingByPlaceId = new Map<string, Record<string, unknown>>();
    if (placeIds.length > 0) {
      const { data: exs } = await supabase
        .from("businesses")
        .select(`id, place_id, status, field_sources, updated_at, ${IMPORTABLE_FIELDS.join(", ")}`)
        .in("place_id", placeIds);
      (exs ?? []).forEach((r: Record<string, unknown>) => {
        existingByPlaceId.set(String(r.place_id), r);
      });
    }

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

    const { data: approvedMappings } = await supabase
      .from("category_mappings")
      .select("source_category")
      .eq("source_provider", "google")
      .eq("mapping_status", "approved");
    const mappingsApproved = (approvedMappings ?? []).map((r: { source_category: string }) => r.source_category);

    const hashItems: Array<{ placeId: string | null; intent: string; approved: string[]; proposedFields: string[] }> = [];
    let updates = 0;
    let inserts = 0;
    let noops = 0;

    for (const it of items ?? []) {
      const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
      const n = rp.normalized as NormalizedBusiness | null;
      if (!n) continue;
      const existing = existingByPlaceId.get(n.placeId) ?? null;
      const diff = computeProposedDiff(
        n,
        existing,
        existing ? ((existing.field_sources as Record<string, { source?: string }>) ?? null) : null,
      );
      let intent: string = existing ? "update" : "insert";
      if (existing && diff.changedCount === 0) intent = "noop";
      if (intent === "insert") inserts++;
      else if (intent === "update") updates++;
      else noops++;

      // By default, auto-approve all "changed" fields — admin can uncheck.
      // For inserts, approved_fields covers every changed field (whole record).
      const approvedFields = diff.fields
        .filter((f) => f.status === "changed")
        .map((f) => f.field);

      hashItems.push({
        placeId: n.placeId,
        intent,
        approved: [...approvedFields].sort(),
        proposedFields: diff.fields.filter((f) => f.status === "changed").map((f) => f.field).sort(),
      });

      await supabase
        .from("import_batch_items")
        .update({
          intent,
          current_snapshot: existing,
          proposed_diff: diff,
          approved_fields: approvedFields,
        })
        .eq("id", it.id);
    }

    const previewHash = computePreviewHash({
      items: hashItems,
      mappingsApproved,
      settings,
    });

    await supabase
      .from("import_batch_items")
      .update({ preview_hash: previewHash })
      .eq("import_batch_id", data.id)
      .in("status", ["pending"]);
    await advanceStage(supabase, data.id, "preview", {
      preview_hash: previewHash,
      previewed_at: new Date().toISOString(),
    });

    return { ok: true, previewHash, inserts, updates, noops, mappingsApproved: mappingsApproved.length };
  });

/** Admin toggles approved fields on a single update item. */
export const setImportItemApproval = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { itemId: string; approvedFields: string[] }) => {
    if (!i?.itemId) throw new Response("Missing itemId", { status: 400 });
    const allowed = new Set<string>(IMPORTABLE_FIELDS);
    const filtered = (i.approvedFields ?? []).filter((f) => allowed.has(f));
    return { itemId: i.itemId, approvedFields: filtered };
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: item } = await supabase
      .from("import_batch_items")
      .select("id, import_batch_id, status")
      .eq("id", data.itemId)
      .maybeSingle();
    if (!item) throw new Response("Not found", { status: 404 });
    if (item.status !== "pending") throw new Response("Item not pending", { status: 400 });
    // Any manual change invalidates the preview_hash so caller must re-preview.
    await supabase
      .from("import_batch_items")
      .update({ approved_fields: data.approvedFields, preview_hash: null })
      .eq("id", data.itemId);
    await supabase
      .from("import_batches")
      .update({ preview_hash: null })
      .eq("id", item.import_batch_id);
    return { ok: true };
  });

// ---------- Execute ----------

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
    if (!["preview", "execute", "ready", "importing"].includes(batch.stage) &&
        !["ready", "importing", "previewed", "preview"].includes(batch.status))
      throw new Response(`Batch is stage=${batch.stage}, cannot run`, { status: 400 });
    if (!batch.preview_hash)
      throw new Response("Missing preview_hash — compute preview first", { status: 400 });

    // Load next chunk of pending items whose preview_hash still matches.
    const { data: items } = await supabase
      .from("import_batch_items")
      .select("*")
      .eq("import_batch_id", data.id)
      .eq("status", "pending")
      .eq("preview_hash", batch.preview_hash)
      .order("item_index")
      .limit(CHUNK_SIZE);

    if (!items || items.length === 0) {
      // Nothing runnable — either done or stale.
      const { count: stale } = await supabase
        .from("import_batch_items")
        .select("id", { count: "exact", head: true })
        .eq("import_batch_id", data.id)
        .eq("status", "pending")
        .neq("preview_hash", batch.preview_hash);
      if ((stale ?? 0) > 0) {
        return { ok: false, processed: 0, done: false, staleItems: stale, needsRepreview: true };
      }
      await finalizeExecute(supabase, data.id);
      return { ok: true, processed: 0, done: true };
    }

    if (batch.status !== "importing") {
      await supabase
        .from("import_batches")
        .update({ status: "importing", started_at: batch.started_at ?? new Date().toISOString() })
        .eq("id", data.id);
      await advanceStage(supabase, data.id, "execute");
    }

    // Load settings + approved mappings once per chunk.
    const settingKeys = [
      "import.default_status",
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
    const requireKnownCity = settings["import.require_known_city"] === true;
    const requireCategoryMapping = settings["import.require_category_mapping"] === true;

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
      const intent = String(item.intent ?? "insert");
      const approved: ImportableField[] = Array.isArray(item.approved_fields)
        ? (item.approved_fields as ImportableField[])
        : [];
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
          await markItem(supabase, item.id, "needs_mapping", "needs_mapping", "unmapped_category");
          skipped++;
          continue;
        }

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
          popular_times: normalized.popularTimes as unknown,
          city_id: cityId,
          primary_category_id: primaryCatId,
          raw_data: normalized.raw as unknown,
          place_id: normalized.placeId,
          slug,
        };

        const patch: Record<string, unknown> = {};
        const appliedFields: string[] = [];

        if (existing) {
          // UPDATE — only apply fields explicitly approved by admin.
          for (const f of approved) {
            const src = fieldSources[f]?.source;
            if (src === "admin" || src === "owner") continue; // safety, should have been blocked in preview
            patch[f] = wanted[f];
            fieldSources[f] = { source: "import", updated_at: nowIso };
            appliedFields.push(f);
          }
          if (appliedFields.length === 0 && intent !== "noop") {
            // Approved 0 fields — record as noop.
            await recordProvenance(supabase, existing.id, item.import_batch_id, item.id, "noop", []);
            await markItem(supabase, item.id, "skipped", "skip", "no_fields_approved", existing.id);
            skipped++;
            continue;
          }
          if (appliedFields.length > 0) {
            patch.field_sources = fieldSources;
            const { error: uErr } = await supabase
              .from("businesses")
              .update(patch)
              .eq("id", existing.id);
            if (uErr) throw uErr;
            updated++;
            touchedBusinessIds.add(existing.id);
            await recordProvenance(
              supabase,
              existing.id,
              item.import_batch_id,
              item.id,
              "update",
              appliedFields,
            );
            await markItem(supabase, item.id, "updated", "update", null, existing.id);
          } else {
            await recordProvenance(supabase, existing.id, item.import_batch_id, item.id, "noop", []);
            await markItem(supabase, item.id, "skipped", "skip", "noop", existing.id);
            skipped++;
          }
        } else {
          // INSERT — write full record, always as `pending_review`.
          for (const f of IMPORTABLE_FIELDS) {
            patch[f] = wanted[f];
            fieldSources[f] = { source: "import", updated_at: nowIso };
            appliedFields.push(f);
          }
          patch.city_id = cityId;
          patch.primary_category_id = primaryCatId;
          patch.raw_data = wanted.raw_data;
          patch.place_id = normalized.placeId;
          patch.slug = slug;
          patch.field_sources = fieldSources;
          patch.status = defaultStatus;
          patch.source = "google_json";
          const { data: ins, error: iErr } = await supabase
            .from("businesses")
            .insert(patch)
            .select("id")
            .single();
          if (iErr) throw iErr;
          const businessId = ins.id as string;
          inserted++;
          touchedBusinessIds.add(businessId);
          await recordProvenance(supabase, businessId, item.import_batch_id, item.id, "insert", appliedFields);
          await markItem(supabase, item.id, "inserted", "insert", null, businessId);
        }

        const businessIdForChildren = existing?.id ?? [...touchedBusinessIds].pop()!;

        // Opening hours: replace only for inserts / when explicitly approved.
        if (!existing && normalized.openingHours.length > 0) {
          await supabase.from("business_opening_hours").delete().eq("business_id", businessIdForChildren);
          const hoursRows = normalized.openingHours.map((h) => ({
            business_id: businessIdForChildren,
            day_of_week: h.dayOfWeek,
            open_time: h.openTime,
            close_time: h.closeTime,
            is_closed: h.isClosed,
          }));
          await supabase.from("business_opening_hours").insert(hoursRows);
        }

        // Images / reviews — always upserted from source (idempotent).
        if (normalized.images.length > 0) {
          for (const img of normalized.images) {
            const { error: imgErr } = await supabase.from("business_images").upsert(
              {
                business_id: businessIdForChildren,
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

        if (normalized.reviews.length > 0) {
          for (const r of normalized.reviews) {
            const { error: revErr } = await supabase.from("reviews").upsert(
              {
                business_id: businessIdForChildren,
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

        if (!existing) {
          const catIds = Array.from(
            new Set(
              [primaryCatId, ...normalized.categoriesSource.map((c) => mappingIndex.get(c) ?? null)].filter(
                (x): x is string => !!x,
              ),
            ),
          );
          if (catIds.length > 0) {
            await supabase.from("business_category_links").delete().eq("business_id", businessIdForChildren);
            const links = catIds.map((cid) => ({
              business_id: businessIdForChildren,
              category_id: cid,
              is_primary: cid === primaryCatId,
            }));
            await supabase.from("business_category_links").insert(links);
          }
        }
      } catch (e) {
        failed++;
        await markItem(supabase, item.id, "failed", null, (e as Error).message?.slice(0, 400) ?? "error");
      }
    }

    // Enqueue translation jobs for every business touched this chunk.
    if (touchedBusinessIds.size > 0) {
      try {
        const { enqueueMissingTranslations } = await import(
          "@/lib/translations/service.server"
        );
        for (const bid of touchedBusinessIds) {
          await enqueueMissingTranslations(bid).catch((err) => {
            console.warn("[import] enqueueMissingTranslations failed", bid, err);
          });
        }
      } catch (err) {
        console.warn("[import] translation enqueue module failed", err);
      }
    }

    await supabase.rpc("record_audit", {
      _action: "import.chunk",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: null,
      _metadata: { inserted, updated, skipped, failed, chunk_size: items.length },
    });

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
      .eq("status", "pending")
      .eq("preview_hash", batch.preview_hash);

    const done = !remaining || remaining === 0;
    if (done) await finalizeExecute(supabase, data.id);

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

async function finalizeExecute(supabase: Sb, id: string) {
  const { data: b } = await supabase
    .from("import_batches")
    .select("failed_items, invalid_items, inserted_items, updated_items")
    .eq("id", id)
    .maybeSingle();
  const anyFailure = (b?.failed_items ?? 0) > 0 || (b?.invalid_items ?? 0) > 0;
  const anySuccess = (b?.inserted_items ?? 0) > 0 || (b?.updated_items ?? 0) > 0;
  const finalStatus =
    anyFailure && anySuccess
      ? "partially_completed"
      : anyFailure && !anySuccess
        ? "failed"
        : "completed";
  await supabase
    .from("import_batches")
    .update({ status: finalStatus })
    .eq("id", id);
  await advanceStage(supabase, id, "translations");
}

// ---------- Translations / Images stages ----------

export const enqueueBatchTranslations = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: rows } = await supabase
      .from("business_import_provenance")
      .select("business_id")
      .eq("import_batch_id", data.id);
    const businessIds = Array.from(new Set((rows ?? []).map((r: { business_id: string }) => r.business_id)));
    let enqueued = 0;
    let failed = 0;
    try {
      const { enqueueMissingTranslations } = await import("@/lib/translations/service.server");
      for (const bid of businessIds as string[]) {
        try {
          await enqueueMissingTranslations(bid);
          enqueued++;
        } catch {
          failed++;
        }
      }
    } catch (err) {
      throw new Response(`translation module failed: ${(err as Error).message}`, { status: 500 });
    }
    await advanceStage(supabase, data.id, "images");
    return { ok: true, enqueued, failed, businesses: businessIds.length };
  });

export const markImagesStageDone = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    // Images pipeline is Blocked by configuration (R2). We only advance the
    // stage; jobs remain in the queue table and are processed independently.
    await advanceStage(supabase, data.id, "publish");
    return { ok: true, note: "R2 image pipeline is Blocked by configuration; advancing to publish stage." };
  });

// ---------- Publish ----------

export const publishImportBatch = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: rows } = await supabase
      .from("business_import_provenance")
      .select("business_id")
      .eq("import_batch_id", data.id);
    const businessIds = Array.from(new Set((rows ?? []).map((r: { business_id: string }) => r.business_id)));
    let published = 0;
    if (businessIds.length > 0) {
      const { data: touched } = await supabase
        .from("businesses")
        .update({ status: "published" })
        .in("id", businessIds)
        .eq("status", "pending_review")
        .select("id");
      published = (touched ?? []).length;
    }
    await supabase
      .from("import_batches")
      .update({ published_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("id", data.id);
    await advanceStage(supabase, data.id, "completed");
    await supabase.rpc("record_audit", {
      _action: "import.publish",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: { published },
      _metadata: { businesses: businessIds.length },
    });
    return { ok: true, published, businesses: businessIds.length };
  });

// ---------- Cancel / delete / archive ----------

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

export const deleteImportBatch = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("stage, storage_bucket, storage_object_path")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (EXECUTED_STAGES.has(String(batch.stage)))
      throw new Response(`Cannot delete after execute (stage=${batch.stage}). Archive instead.`, { status: 400 });
    if (batch.storage_object_path) {
      try {
        await supabase.storage
          .from(batch.storage_bucket ?? IMPORTS_BUCKET)
          .remove([batch.storage_object_path]);
      } catch {
        /* best-effort */
      }
    }
    await supabase.from("import_batch_items").delete().eq("import_batch_id", data.id);
    await supabase.from("import_batches").delete().eq("id", data.id);
    return { ok: true };
  });

export const archiveImportBatch = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("stage")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (!EXECUTED_STAGES.has(String(batch.stage)))
      throw new Response(`Only executed batches can be archived (stage=${batch.stage})`, { status: 400 });
    await supabase
      .from("import_batches")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: true };
  });

// ---------- Helpers ----------

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

async function recordProvenance(
  supabase: Sb,
  businessId: string,
  batchId: string,
  itemId: string,
  action: "insert" | "update" | "noop",
  fields: string[],
) {
  await supabase.from("business_import_provenance").insert({
    business_id: businessId,
    import_batch_id: batchId,
    import_batch_item_id: itemId,
    applied_action: action,
    applied_fields: fields,
  });
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
