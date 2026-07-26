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
import { requireAdmin } from "./require-admin.middleware";
import {
  detectImportFormat,
  extractImportItems,
  unwrapRecord,
} from "@/lib/import/format";
import {
  normalizeGooglePlace,
  normalizeImages,
  normalizeReviews,
  validateNormalizedBusiness,
  type NormalizedBusiness,
} from "@/lib/import/normalize";
import {
  computeProposedDiff,
  computePreviewHash,
  IMPORTABLE_FIELDS,
  type ImportableField,
} from "@/lib/import/preview";
import {
  detectSchema,
  suggestFieldMapping,
  computeSchemaHash,
  computeFieldMappingHash,
  applyMappingEdits,
  type MappingRow,
} from "@/lib/import/schema-detector";
import { sha256Hex } from "@/lib/utils/sha256";
import {
  generateAIDescription,
  generateSeoContent,
  classifyEnrichmentError,
  getBackoffDelay as enrichmentBackoff,
  SUPPORTED_LOCALES,
  ENRICHMENT_PROMPT_VERSION,
} from "@/lib/enrichment/generator.server";
import { computeSourceHash, computeGenerationKey, isGenerationFresh, pickSourceHashLabel } from "@/lib/enrichment/generation-key";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const CHUNK_SIZE = 50;
const IMPORTS_BUCKET = "imports";

/**
 * TEMPORARY TEST IMPORT LIMIT — set to >0 to restrict runImportChunk to N records.
 * Affects ONLY the execute stage (not analysis, preview, field detection, or Stage 5 mapping).
 * Remaining records stay untouched; batch is NOT marked complete.
 *
 * To disable: set to 0 (or delete/comment this constant) before importing the full file.
 */
const TEST_IMPORT_LIMIT =
  process.env.NODE_ENV === "development" ? 10 : 0;

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
  const { data: b, error: readError } = await supabase
    .from("import_batches")
    .select("stage, stage_history")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Response(readError.message, { status: 500 });
  if (!b) throw new Response("Import batch not found", { status: 404 });
  const history = Array.isArray(b?.stage_history) ? (b.stage_history as unknown[]) : [];
  const entry = { at: nowIso, from: b?.stage ?? null, to: stage };
  const nextHistory = [...history, entry].slice(-50);
  const { error: updateError } = await supabase
    .from("import_batches")
    .update({ stage, stage_history: nextHistory, ...patch })
    .eq("id", id);
  if (updateError) throw new Response(`Could not advance import stage to ${stage}: ${updateError.message}`, { status: 500 });
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

// ---------- Execution state (Phase B) ----------

export type ExecutionStatus = "idle" | "running" | "paused" | "stopped" | "completed" | "failed";

export interface ExecutionLogEntry {
  at: string;
  type: "info" | "warn" | "error" | "retry";
  message: string;
}

export interface ImportExecutionState {
  status: ExecutionStatus;
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  delayMs: number;
  retryAttempt: number;
  maxRetries: number;
  chunksCompleted: number;
  totalChunkDurationMs: number;
  log: ExecutionLogEntry[];
}

function defaultExecutionState(): ImportExecutionState {
  return {
    status: "idle",
    startedAt: null,
    pausedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    errorMessage: null,
    delayMs: 250,
    retryAttempt: 0,
    maxRetries: 3,
    chunksCompleted: 0,
    totalChunkDurationMs: 0,
    log: [],
  };
}

function classifyImportError(err: Error): "transient" | "permanent" {
  const m = err.message.toLowerCase();
  if (
    m.includes("network") ||
    m.includes("econnrefused") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("enotfound") ||
    m.includes("fetch failed")
  )
    return "transient";
  if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) return "transient";
  if (m.includes("502") || m.includes("503") || m.includes("504")) return "transient";
  if (m.includes("409") || m.includes("already processing")) return "transient";
  return "permanent";
}

function getBackoffDelay(attempt: number): number {
  const base = 1000;
  const cap = 30000;
  return Math.round(Math.min(base * Math.pow(2, attempt) + Math.random() * base, cap));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ExecutionCommand = "start" | "pause" | "resume" | "stop" | "set_delay" | "recover";

function buildExecutionPatch(
  current: Record<string, unknown>,
  command: ExecutionCommand,
  delayMs?: number,
): ImportExecutionState {
  const now = new Date().toISOString();
  const base = defaultExecutionState();
  const existing: ImportExecutionState = { ...base, ...(current as unknown as ImportExecutionState) };

  switch (command) {
    case "start":
    case "resume":
      return {
        ...existing,
        status: "running",
        startedAt: existing.startedAt ?? now,
        pausedAt: null,
        stoppedAt: null,
        failedAt: null,
        errorMessage: null,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: command === "resume" ? "Execution resumed" : "Execution started" },
        ],
      };
    case "pause":
      return {
        ...existing,
        status: "paused",
        pausedAt: now,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Execution paused" },
        ],
      };
    case "stop":
      return {
        ...existing,
        status: "stopped",
        stoppedAt: now,
        errorMessage: null,
        retryAttempt: 0,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Execution stopped" },
        ],
      };
    case "set_delay":
      return {
        ...existing,
        delayMs: delayMs ?? existing.delayMs,
      };
    case "recover":
      return {
        ...existing,
        status: "running",
        pausedAt: null,
        stoppedAt: null,
        failedAt: null,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Execution recovered after interruption" },
        ],
      };
  }
}

export const getImportExecutionState = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("metadata, processed_items, total_items, failed_items, status, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    const metadata = (batch.metadata as Record<string, unknown>) ?? {};
    const exec = (metadata.execution as ImportExecutionState | null) ?? null;
    return {
      execution: exec,
      counters: {
        processed: batch.processed_items ?? 0,
        total: batch.total_items ?? 0,
        failed: batch.failed_items ?? 0,
      },
      remaining: Math.max(0, (batch.total_items ?? 0) - (batch.processed_items ?? 0)),
      batchStatus: batch.status,
      batchStage: batch.stage,
    };
  });

export const updateImportExecutionControl = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string; command: string; delayMs?: number }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    if (!["start", "pause", "resume", "stop", "set_delay", "recover"].includes(i.command))
      throw new Response("Invalid command", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("metadata, stage, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });

    // Validate stage: only allow execution controls in execute/preview stage
    if (!["preview", "execute"].includes(String(batch.stage))) {
      throw new Response(`Cannot control execution in stage=${batch.stage}`, { status: 400 });
    }
    if (["completed", "partially_completed", "failed", "cancelled", "archived"].includes(String(batch.status))) {
      throw new Response(`Batch status=${batch.status}`, { status: 400 });
    }

    const metadata = (batch.metadata as Record<string, unknown>) ?? {};
    const exec = (metadata.execution as Record<string, unknown>) ?? {};
    const currentStatus = String(exec?.status ?? "idle");

    if ((data.command === "start" || data.command === "resume") && currentStatus === "running") {
      return { ok: true, execution: exec as unknown as ImportExecutionState };
    }

    const patch = buildExecutionPatch(exec, data.command as ExecutionCommand, data.delayMs);

    await supabase
      .from("import_batches")
      .update({ metadata: { ...metadata, execution: patch } })
      .eq("id", data.id);

    return { ok: true, execution: patch };
  });

export const executeImportChunk = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;

    async function readBatch() {
      const r = await supabase
        .from("import_batches")
        .select("metadata, processed_items, total_items, status, stage")
        .eq("id", data.id)
        .maybeSingle();
      if (!r) throw new Response("Not found", { status: 404 });
      const m = (r.metadata as Record<string, unknown>) ?? {};
      return { row: r, metadata: m, exec: (m.execution as Record<string, unknown>) ?? {} };
    }

    const initialBatch = await readBatch();
    const row = initialBatch.row;
    let metadata = initialBatch.metadata;
    let exec = initialBatch.exec;
    if (exec.status !== "running") {
      return { skipped: true, reason: String(exec.status ?? "idle") };
    }
    if (!["preview", "execute"].includes(String(row.stage))) {
      return { skipped: true, reason: `wrong_stage:${row.stage}` };
    }
    if (["completed", "partially_completed", "failed", "cancelled", "archived"].includes(String(row.status))) {
      return { skipped: true, reason: `batch_ended:${row.status}` };
    }

    const { count: remaining } = await supabase
      .from("import_batch_items")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", data.id)
      .eq("status", "pending");

    if (!remaining || remaining === 0) {
      const patch = {
        ...exec,
        status: "completed" as const,
        completedAt: new Date().toISOString(),
        errorMessage: null,
        retryAttempt: 0,
        log: [
          ...((exec.log as ExecutionLogEntry[]) ?? []).slice(-99),
          { at: new Date().toISOString(), type: "info" as const, message: "All items processed" },
        ],
      };
      await supabase
        .from("import_batches")
        .update({ metadata: { ...metadata, execution: patch } })
        .eq("id", data.id);
      return { done: true, skipped: false };
    }

    let lastError: Error | null = null;
    const maxRetries = Number(exec.maxRetries ?? 3);
    let previousProcessed = row.processed_items ?? 0;
    let chunksCompleted = Number(exec.chunksCompleted ?? 0);
    let totalChunkDurationMs = Number(exec.totalChunkDurationMs ?? 0);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const beforeAttempt = previousProcessed;
      const attemptStart = Date.now();
      try {
        const result = await runImportChunk({ data: { id: data.id } });
        totalChunkDurationMs += Date.now() - attemptStart;
        chunksCompleted += 1;

        const log = ((exec.log as ExecutionLogEntry[]) ?? []).slice(-99);
        log.push({
          at: new Date().toISOString(),
          type: "info",
          message: `Chunk: ${result.processed} items (${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed)`,
        });

        const patch: ImportExecutionState = {
          ...(exec as unknown as ImportExecutionState),
          chunksCompleted,
          totalChunkDurationMs,
          status: "running",
          errorMessage: null,
          retryAttempt: 0,
          log,
        };
        await supabase
          .from("import_batches")
          .update({ metadata: { ...metadata, execution: patch } })
          .eq("id", data.id);

        return result;
      } catch (err) {
        lastError = err as Error;
        const errorType = classifyImportError(lastError);

        if (errorType === "permanent") {
          const fresh = await readBatch();
          metadata = fresh.metadata; exec = fresh.exec; previousProcessed = fresh.row.processed_items ?? 0;
          const log = ((exec.log as ExecutionLogEntry[]) ?? []).slice(-99);
          log.push({
            at: new Date().toISOString(),
            type: "error",
            message: `Permanent error: ${lastError.message}`,
          });
          const patch: ImportExecutionState = {
            ...(exec as unknown as ImportExecutionState),
            status: "failed",
            errorMessage: lastError.message,
            failedAt: new Date().toISOString(),
            retryAttempt: Number(exec.retryAttempt ?? 0) + 1,
            log,
          };
          await supabase
            .from("import_batches")
            .update({ metadata: { ...metadata, execution: patch } })
            .eq("id", data.id);
          throw lastError;
        }

        const fresh = await readBatch();
        metadata = fresh.metadata; exec = fresh.exec; previousProcessed = fresh.row.processed_items ?? 0;

        if (previousProcessed > beforeAttempt) {
          chunksCompleted += 1;
          const log = ((exec.log as ExecutionLogEntry[]) ?? []).slice(-99);
          log.push({
            at: new Date().toISOString(),
            type: "info",
            message: `Chunk completed on previous attempt (processed advanced: ${beforeAttempt} → ${previousProcessed})`,
          });
          const patch: ImportExecutionState = {
            ...(exec as unknown as ImportExecutionState),
            chunksCompleted,
            retryAttempt: 0,
            log,
          };
          await supabase
            .from("import_batches")
            .update({ metadata: { ...metadata, execution: patch } })
            .eq("id", data.id);
          return { processed: previousProcessed - beforeAttempt };
        }

        if (attempt >= maxRetries) {
          const log = ((exec.log as ExecutionLogEntry[]) ?? []).slice(-99);
          log.push({
            at: new Date().toISOString(),
            type: "error",
            message: `Transient error (attempt ${attempt + 1}/${maxRetries}) — final: ${lastError.message}`,
          });
          const patch: ImportExecutionState = {
            ...(exec as unknown as ImportExecutionState),
            status: "failed",
            errorMessage: `Transient error after ${attempt + 1} retries: ${lastError.message}`,
            failedAt: new Date().toISOString(),
            retryAttempt: Number(exec.retryAttempt ?? 0) + 1,
            log,
          };
          await supabase
            .from("import_batches")
            .update({ metadata: { ...metadata, execution: patch } })
            .eq("id", data.id);
          throw lastError;
        }

        const log = ((exec.log as ExecutionLogEntry[]) ?? []).slice(-99);
        log.push({
          at: new Date().toISOString(),
          type: "retry",
          message: `Transient error (attempt ${attempt + 1}/${maxRetries}), retrying in ${getBackoffDelay(attempt)}ms: ${lastError.message}`,
        });
        const patch: ImportExecutionState = {
          ...(exec as unknown as ImportExecutionState),
          status: "running",
          retryAttempt: Number(exec.retryAttempt ?? 0) + 1,
          log,
        };
        await supabase
          .from("import_batches")
          .update({ metadata: { ...metadata, execution: patch } })
          .eq("id", data.id);

        await sleep(getBackoffDelay(attempt));
      }
    }

    throw lastError ?? new Response("Execution failed", { status: 500 });
  });

// ---------- Enrichment state (Phase C) ----------

export type EnrichmentStatus = "idle" | "running" | "paused" | "stopped" | "completed" | "failed";

export interface ImportEnrichmentState {
  status: EnrichmentStatus;
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  delayMs: number;
  retryAttempt: number;
  maxRetries: number;
  businessesTotal: number;
  businessesProcessed: number;
  businessesCompleted: number;
  businessesFailed: number;
  businessesRetryable: number;
  businessesStale: number;
  descriptionsGenerated: number;
  seoArGenerated: number;
  seoEnGenerated: number;
  seoTrGenerated: number;
  latestError: string | null;
  lastRetryCount: number;
  totalDurationMs: number;
  log: ExecutionLogEntry[];
}

function defaultEnrichmentState(): ImportEnrichmentState {
  return {
    status: "idle",
    startedAt: null,
    pausedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    errorMessage: null,
    delayMs: 500,
    retryAttempt: 0,
    maxRetries: 3,
    businessesTotal: 0,
    businessesProcessed: 0,
    businessesCompleted: 0,
    businessesFailed: 0,
    businessesRetryable: 0,
    businessesStale: 0,
    descriptionsGenerated: 0,
    seoArGenerated: 0,
    seoEnGenerated: 0,
    seoTrGenerated: 0,
    latestError: null,
    lastRetryCount: 0,
    totalDurationMs: 0,
    log: [],
  };
}

type EnrichmentCommand = "start" | "pause" | "resume" | "stop" | "set_delay" | "recover";

function buildEnrichmentPatch(
  current: Record<string, unknown>,
  command: EnrichmentCommand,
  delayMs?: number,
): ImportEnrichmentState {
  const now = new Date().toISOString();
  const base = defaultEnrichmentState();
  const existing: ImportEnrichmentState = { ...base, ...(current as unknown as ImportEnrichmentState) };

  switch (command) {
    case "start":
    case "resume":
      return {
        ...existing,
        status: "running",
        startedAt: existing.startedAt ?? now,
        pausedAt: null,
        stoppedAt: null,
        failedAt: null,
        errorMessage: null,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: command === "resume" ? "Enrichment resumed" : "Enrichment started" },
        ],
      };
    case "pause":
      return {
        ...existing,
        status: "paused",
        pausedAt: now,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Enrichment paused" },
        ],
      };
    case "stop":
      return {
        ...existing,
        status: "stopped",
        stoppedAt: now,
        errorMessage: null,
        retryAttempt: 0,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Enrichment stopped" },
        ],
      };
    case "set_delay":
      return {
        ...existing,
        delayMs: delayMs ?? existing.delayMs,
      };
    case "recover":
      return {
        ...existing,
        status: "running",
        pausedAt: null,
        stoppedAt: null,
        failedAt: null,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Enrichment recovered after interruption" },
        ],
      };
  }
}

export const getEnrichmentState = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("metadata, status, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    const metadata = (batch.metadata as Record<string, unknown>) ?? {};
    const enrich = (metadata.enrichment as ImportEnrichmentState | null) ?? null;
    return {
      enrichment: enrich,
      counters: enrich
        ? {
            processed: enrich.businessesProcessed,
            total: enrich.businessesTotal,
            completed: enrich.businessesCompleted,
            failed: enrich.businessesFailed,
            retryable: enrich.businessesRetryable,
            stale: enrich.businessesStale,
            descriptionsGenerated: enrich.descriptionsGenerated,
            seoArGenerated: enrich.seoArGenerated,
            seoEnGenerated: enrich.seoEnGenerated,
            seoTrGenerated: enrich.seoTrGenerated,
            latestError: enrich.latestError,
            lastRetryCount: enrich.lastRetryCount,
          }
        : null,
      remaining: enrich ? Math.max(0, enrich.businessesTotal - enrich.businessesProcessed) : 0,
    };
  });

export const updateEnrichmentControl = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string; command: string; delayMs?: number }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    if (!["start", "pause", "resume", "stop", "set_delay", "recover"].includes(i.command))
      throw new Response("Invalid command", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("metadata, stage, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });

    if (!["enrich"].includes(String(batch.stage))) {
      throw new Response(`Cannot control enrichment in stage=${batch.stage}`, { status: 400 });
    }
    if (["completed", "partially_completed", "failed", "cancelled", "archived"].includes(String(batch.status))) {
      throw new Response(`Batch status=${batch.status}`, { status: 400 });
    }

    const metadata = (batch.metadata as Record<string, unknown>) ?? {};
    const enrich = (metadata.enrichment as Record<string, unknown>) ?? {};
    const currentStatus = String(enrich?.status ?? "idle");

    if ((data.command === "start" || data.command === "resume") && currentStatus === "running") {
      return { ok: true, enrichment: enrich as unknown as ImportEnrichmentState };
    }

    const patch = buildEnrichmentPatch(enrich, data.command as EnrichmentCommand, data.delayMs);

    await supabase
      .from("import_batches")
      .update({ metadata: { ...metadata, enrichment: patch } })
      .eq("id", data.id);

    return { ok: true, enrichment: patch };
  });

async function generateContentForBusiness(
  supabase: Sb,
  businessId: string,
): Promise<{
  descriptionGenerated: boolean;
  descriptionFailed: boolean;
  descriptionStale: boolean;
  seoArGenerated: boolean;
  seoArFailed: boolean;
  seoArStale: boolean;
  seoEnGenerated: boolean;
  seoEnFailed: boolean;
  seoEnStale: boolean;
  seoTrGenerated: boolean;
  seoTrFailed: boolean;
  seoTrStale: boolean;
  latestError: string | null;
  lastRetryCount: number;
}> {
  const { data: biz } = await supabase
    .from("businesses")
    .select("id, name, description, original_language, primary_category_id, city_id")
    .eq("id", businessId)
    .maybeSingle();
  if (!biz) return { descriptionGenerated: false, descriptionFailed: false, descriptionStale: false, seoArGenerated: false, seoArFailed: false, seoArStale: false, seoEnGenerated: false, seoEnFailed: false, seoEnStale: false, seoTrGenerated: false, seoTrFailed: false, seoTrStale: false, latestError: null, lastRetryCount: 0 };

  const business = biz as Record<string, unknown>;
  const originalLanguage = String(business.original_language ?? "en");
  const existingDescription = String(business.description ?? "").trim();

  let categoryName = "";
  if (business.primary_category_id) {
    const { data: cat } = await supabase
      .from("category_translations")
      .select("name")
      .eq("category_id", business.primary_category_id)
      .eq("language_code", originalLanguage)
      .limit(1)
      .maybeSingle();
    if (cat) {
      categoryName = pickSourceHashLabel(
        [{ language_code: originalLanguage, name: String((cat as Record<string, unknown>).name ?? "") }],
        originalLanguage,
      );
    }
  }
  let cityName = "";
  if (business.city_id) {
    const { data: ct } = await supabase
      .from("city_translations")
      .select("name")
      .eq("city_id", business.city_id)
      .eq("language_code", originalLanguage)
      .limit(1)
      .maybeSingle();
    if (ct) {
      cityName = pickSourceHashLabel(
        [{ language_code: originalLanguage, name: String((ct as Record<string, unknown>).name ?? "") }],
        originalLanguage,
      );
    }
  }

  const businessData = {
    name: String(business.name ?? ""),
    category: categoryName,
    city: cityName,
    originalLanguage,
    existingDescription,
  };

  const currentSourceHash = computeSourceHash(businessData);
  const promptVersion = ENRICHMENT_PROMPT_VERSION;
  const maxRetries = 3;

  // ---- Description ----
  let descriptionGenerated = false;
  let descriptionFailed = false;
  let descriptionStale = false;
  let latestError: string | null = null;
  let lastRetryCount = 0;

  const descGenKey = computeGenerationKey({
    businessId,
    contentType: "description",
    locale: originalLanguage,
    sourceHash: currentSourceHash,
    promptVersion,
  });

  const { data: existingDesc } = await supabase
    .from("business_content_generation")
    .select("generation_status, source_content_hash, prompt_version")
    .eq("generation_key", descGenKey)
    .maybeSingle();

  if (existingDesc && isGenerationFresh({
    recordStatus: String((existingDesc as Record<string, unknown>).generation_status ?? ""),
    recordSourceHash: String((existingDesc as Record<string, unknown>).source_content_hash ?? ""),
    recordPromptVersion: String((existingDesc as Record<string, unknown>).prompt_version ?? ""),
    currentSourceHash,
    currentPromptVersion: promptVersion,
  })) {
    // Fresh — skip
  } else {
    if (existingDesc) descriptionStale = true;
    // Mark ALL records for this (business_id, content_type) as stale,
    // except the current generation key — this catches both "completed"
    // and "processing" records from any older generation.
    await supabase
      .from("business_content_generation")
      .update({ generation_status: "stale" })
      .eq("business_id", businessId)
      .eq("content_type", "description")
      .neq("generation_key", descGenKey);

    await upsertGenerationRecord(supabase, {
      businessId,
      contentType: "description",
      locale: originalLanguage,
      promptVersion,
      sourceHash: currentSourceHash,
      generationKey: descGenKey,
      status: "processing",
      errorMessage: null,
      retryCount: 0,
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const output = await generateAIDescription(businessData, originalLanguage);
        const { error: descErr } = await supabase
          .from("businesses")
          .update({ description: output.description })
          .eq("id", businessId);
        if (descErr) throw descErr;

        await upsertGenerationRecord(supabase, {
          businessId,
          contentType: "description",
          locale: originalLanguage,
          promptVersion,
          sourceHash: currentSourceHash,
          generationKey: descGenKey,
          status: "completed",
          errorMessage: null,
          retryCount: attempt,
          generatedContent: output.description,
        });
        // After completing, mark any other completed record for this
        // (biz, type, locale) as stale — handles concurrent completion races.
        await supabase
          .from("business_content_generation")
          .update({ generation_status: "stale" })
          .eq("business_id", businessId)
          .eq("content_type", "description")
          .eq("locale", originalLanguage)
          .neq("generation_key", descGenKey)
          .eq("generation_status", "completed");
        descriptionGenerated = true;
        latestError = null;
        lastRetryCount = 0;
        break;
      } catch (err) {
        const e = err as Error;
        latestError = e.message;
        lastRetryCount = attempt + 1;
        const errorType = classifyEnrichmentError(e);
        if (errorType === "permanent" || attempt >= maxRetries) {
          await upsertGenerationRecord(supabase, {
            businessId,
            contentType: "description",
            locale: originalLanguage,
            promptVersion,
            sourceHash: currentSourceHash,
            generationKey: descGenKey,
            status: "failed",
            errorMessage: e.message,
            retryCount: attempt,
          });
          descriptionFailed = true;
          break;
        }
        await upsertGenerationRecord(supabase, {
          businessId,
          contentType: "description",
          locale: originalLanguage,
          promptVersion,
          sourceHash: currentSourceHash,
          generationKey: descGenKey,
          status: "processing",
          errorMessage: e.message,
          retryCount: attempt + 1,
        });
        await sleep(enrichmentBackoff(attempt));
      }
    }
  }

  // ---- SEO (per locale) ----
  let seoArGenerated = false, seoArFailed = false, seoArStale = false;
  let seoEnGenerated = false, seoEnFailed = false, seoEnStale = false;
  let seoTrGenerated = false, seoTrFailed = false, seoTrStale = false;

  for (const locale of SUPPORTED_LOCALES) {
    let localeGenerated = false, localeFailed = false, localeStale = false;

    const seoGenKey = computeGenerationKey({
      businessId,
      contentType: "seo",
      locale,
      sourceHash: currentSourceHash,
      promptVersion,
    });

    const { data: existingSeo } = await supabase
      .from("business_content_generation")
      .select("generation_status, source_content_hash, prompt_version")
      .eq("generation_key", seoGenKey)
      .maybeSingle();

    if (
      existingSeo &&
      isGenerationFresh({
        recordStatus: String((existingSeo as Record<string, unknown>).generation_status ?? ""),
        recordSourceHash: String((existingSeo as Record<string, unknown>).source_content_hash ?? ""),
        recordPromptVersion: String((existingSeo as Record<string, unknown>).prompt_version ?? ""),
        currentSourceHash,
        currentPromptVersion: promptVersion,
      })
    ) {
      continue;
    }

    if (existingSeo) localeStale = true;
    await supabase
      .from("business_content_generation")
      .update({ generation_status: "stale" })
      .eq("business_id", businessId)
      .eq("content_type", "seo")
      .eq("locale", locale)
      .neq("generation_key", seoGenKey);

    await upsertGenerationRecord(supabase, {
      businessId,
      contentType: "seo",
      locale,
      promptVersion,
      sourceHash: currentSourceHash,
      generationKey: seoGenKey,
      status: "processing",
      errorMessage: null,
      retryCount: 0,
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const output = await generateSeoContent(businessData, locale);
        await upsertGenerationRecord(supabase, {
          businessId,
          contentType: "seo",
          locale,
          promptVersion,
          sourceHash: currentSourceHash,
          generationKey: seoGenKey,
          status: "completed",
          errorMessage: null,
          retryCount: attempt,
          generatedContent: JSON.stringify(output),
        });
        // After completing, mark any other completed record for this
        // (biz, seo, locale) as stale — handles concurrent completion races.
        await supabase
          .from("business_content_generation")
          .update({ generation_status: "stale" })
          .eq("business_id", businessId)
          .eq("content_type", "seo")
          .eq("locale", locale)
          .neq("generation_key", seoGenKey)
          .eq("generation_status", "completed");
        localeGenerated = true;
        latestError = null;
        lastRetryCount = 0;
        break;
      } catch (err) {
        const e = err as Error;
        latestError = e.message;
        lastRetryCount = attempt + 1;
        const errorType = classifyEnrichmentError(e);
        if (errorType === "permanent" || attempt >= maxRetries) {
          await upsertGenerationRecord(supabase, {
            businessId,
            contentType: "seo",
            locale,
            promptVersion,
            sourceHash: currentSourceHash,
            generationKey: seoGenKey,
            status: "failed",
            errorMessage: e.message,
            retryCount: attempt,
          });
          localeFailed = true;
          break;
        }
        await upsertGenerationRecord(supabase, {
          businessId,
          contentType: "seo",
          locale,
          promptVersion,
          sourceHash: currentSourceHash,
          generationKey: seoGenKey,
          status: "processing",
          errorMessage: e.message,
          retryCount: attempt + 1,
        });
        await sleep(enrichmentBackoff(attempt));
      }
    }

    if (locale === "ar") {
      seoArGenerated = localeGenerated;
      seoArFailed = localeFailed;
      seoArStale = localeStale;
    } else if (locale === "en") {
      seoEnGenerated = localeGenerated;
      seoEnFailed = localeFailed;
      seoEnStale = localeStale;
    } else if (locale === "tr") {
      seoTrGenerated = localeGenerated;
      seoTrFailed = localeFailed;
      seoTrStale = localeStale;
    }
  }

  return {
    descriptionGenerated,
    descriptionFailed,
    descriptionStale,
    seoArGenerated,
    seoArFailed,
    seoArStale,
    seoEnGenerated,
    seoEnFailed,
    seoEnStale,
    seoTrGenerated,
    seoTrFailed,
    seoTrStale,
    latestError,
    lastRetryCount,
  };
}

async function upsertGenerationRecord(
  supabase: Sb,
  params: {
    businessId: string;
    contentType: string;
    locale: string;
    promptVersion: string;
    sourceHash: string;
    generationKey: string;
    status: string;
    errorMessage: string | null;
    retryCount: number;
    generatedContent?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();

  // Write-time newer-generation protection:
  // Before writing "completed" or "processing", check if a newer generation
  // has already marked this record as stale. If so, abort — the race was lost.
  if (params.status === "completed" || params.status === "processing") {
    const { data: existing } = await supabase
      .from("business_content_generation")
      .select("generation_status")
      .eq("generation_key", params.generationKey)
      .maybeSingle();
    if (existing && String((existing as Record<string, unknown>).generation_status) === "stale") {
      throw new Error(
        `newer_generation: record was marked stale before write completed`,
      );
    }
  }

  const row: Record<string, unknown> = {
    business_id: params.businessId,
    content_type: params.contentType,
    locale: params.locale,
    prompt_version: params.promptVersion,
    source_content_hash: params.sourceHash,
    generation_key: params.generationKey,
    generation_status: params.status,
    error_message: params.errorMessage,
    retry_count: params.retryCount,
    updated_at: now,
  };
  if (params.generatedContent !== undefined) {
    row.generated_content = params.generatedContent;
  }
  if (params.status === "processing") {
    row.last_attempt_at = now;
  }
  if (params.status === "completed") {
    row.completed_at = now;
  }
  const { error } = await supabase
    .from("business_content_generation")
    .upsert(row, { onConflict: "generation_key" });
  if (error) throw error;
}

export const enqueueBatchEnrichment = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .select("failed_items, invalid_items, status, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (batchError) throw new Response(batchError.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    if ((batch.failed_items ?? 0) > 0 || (batch.invalid_items ?? 0) > 0) {
      throw new Response(
        `Cannot enqueue enrichment for batch with ${batch.failed_items ?? 0} failed and ${batch.invalid_items ?? 0} invalid items.`,
        { status: 409 },
      );
    }

    const { data: rows } = await supabase
      .from("business_import_provenance")
      .select("business_id")
      .eq("import_batch_id", data.id);
    const businessIds = Array.from(new Set((rows ?? []).map((r: { business_id: string }) => r.business_id))) as string[];

    const metadata = (batch.metadata as Record<string, unknown>) ?? {};
    const enrich = defaultEnrichmentState();
    enrich.businessesTotal = businessIds.length;

    await supabase
      .from("import_batches")
      .update({ metadata: { ...metadata, enrichment: enrich } })
      .eq("id", data.id);

    await supabase.rpc("record_audit", {
      _action: "import.enrich.enqueue",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: null,
      _metadata: { businesses: businessIds.length },
    });

    return { ok: true, enqueued: businessIds.length };
  });

export const skipBatchEnrichment = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch, error } = await supabase
      .from("import_batches")
      .select("failed_items, invalid_items, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    if ((batch.failed_items ?? 0) > 0 || (batch.invalid_items ?? 0) > 0) {
      throw new Response(
        `Cannot skip enrichment for a batch with ${batch.failed_items ?? 0} failed and ${batch.invalid_items ?? 0} invalid items.`,
        { status: 409 },
      );
    }
    if (batch.stage !== "enrich") {
      throw new Response(`Cannot skip enrichment in stage ${batch.stage}`, { status: 400 });
    }
    await advanceStage(supabase, data.id, "images");
    await supabase.rpc("record_audit", {
      _action: "import.enrich.skip",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: null,
      _metadata: { reason: "manual_skip" },
    });
    return { ok: true };
  });

export const processEnrichmentChunk = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;

    async function readBatch() {
      const r = await supabase
        .from("import_batches")
        .select("metadata, stage, status")
        .eq("id", data.id)
        .maybeSingle();
      if (!r) throw new Response("Not found", { status: 404 });
      const m = (r.metadata as Record<string, unknown>) ?? {};
      return { row: r, metadata: m, enrich: (m.enrichment as Record<string, unknown>) ?? {} };
    }

    const { row, metadata, enrich } = await readBatch();
    if (enrich.status !== "running") {
      return { skipped: true, reason: String(enrich.status ?? "idle") };
    }
    if (row.stage !== "enrich") {
      return { skipped: true, reason: `wrong_stage:${row.stage}` };
    }
    if (["completed", "partially_completed", "failed", "cancelled", "archived"].includes(String(row.status))) {
      return { skipped: true, reason: `batch_ended:${row.status}` };
    }

    const { data: provenance } = await supabase
      .from("business_import_provenance")
      .select("business_id")
      .eq("import_batch_id", data.id);
    const allBusinessIds = Array.from(new Set((provenance ?? []).map((r: { business_id: string }) => r.business_id))) as string[];
    const totalBusinesses = allBusinessIds.length;

    const processed = Number(enrich.businessesProcessed ?? 0);
    if (processed >= totalBusinesses) {
      const patch = {
        ...enrich,
        status: "completed" as const,
        completedAt: new Date().toISOString(),
        errorMessage: null,
        retryAttempt: 0,
        log: [
          ...((enrich.log as ExecutionLogEntry[]) ?? []).slice(-99),
          { at: new Date().toISOString(), type: "info" as const, message: "All businesses enriched" },
        ],
      };
      await supabase
        .from("import_batches")
        .update({ metadata: { ...metadata, enrichment: patch } })
        .eq("id", data.id);
      return { done: true, skipped: false };
    }

    const chunk = allBusinessIds.slice(processed, processed + 10);
    const chunkStart = Date.now();
    let descGen = 0, descFailed = 0, descStale = 0;
    let seoArGen = 0, seoArFail = 0, seoArStale = 0;
    let seoEnGen = 0, seoEnFail = 0, seoEnStale = 0;
    let seoTrGen = 0, seoTrFail = 0, seoTrStale = 0;
    let businessHasError = false;
    let chunkLatestError: string | null = null;
    let maxRetry = 0;

    for (const businessId of chunk) {
      const result = await generateContentForBusiness(supabase, businessId);
      if (result.descriptionGenerated) descGen++;
      if (result.descriptionFailed) descFailed++;
      if (result.descriptionStale) descStale++;
      if (result.seoArGenerated) seoArGen++;
      if (result.seoArFailed) seoArFail++;
      if (result.seoArStale) seoArStale++;
      if (result.seoEnGenerated) seoEnGen++;
      if (result.seoEnFailed) seoEnFail++;
      if (result.seoEnStale) seoEnStale++;
      if (result.seoTrGenerated) seoTrGen++;
      if (result.seoTrFailed) seoTrFail++;
      if (result.seoTrStale) seoTrStale++;
      if (result.latestError) {
        businessHasError = true;
        chunkLatestError = result.latestError;
      }
      if (result.lastRetryCount > maxRetry) maxRetry = result.lastRetryCount;
    }

    const chunkDuration = Date.now() - chunkStart;
    const newProcessed = Math.min(processed + chunk.length, totalBusinesses);

    const seoTotalGen = seoArGen + seoEnGen + seoTrGen;
    const seoTotalFail = seoArFail + seoEnFail + seoTrFail;
    const seoTotalStale = seoArStale + seoEnStale + seoTrStale;

    const log = ((enrich.log as ExecutionLogEntry[]) ?? []).slice(-99);
    log.push({
      at: new Date().toISOString(),
      type: "info",
      message: [
        `Enrich chunk: ${chunk.length} biz`,
        descGen > 0 || descFailed > 0 ? `desc +${descGen} -${descFailed} ~${descStale}` : "",
        seoTotalGen > 0 || seoTotalFail > 0 ? `seo +${seoTotalGen} -${seoTotalFail} ~${seoTotalStale}` : "",
      ].filter(Boolean).join(", "),
    });

    const prev = enrich as unknown as ImportEnrichmentState;
    const patch: ImportEnrichmentState = {
      ...prev,
      businessesProcessed: newProcessed,
      businessesTotal: totalBusinesses,
      businessesCompleted: prev.businessesCompleted + (descGen > 0 ? 1 : 0),
      businessesFailed: prev.businessesFailed + (descFailed > 0 || seoArFail > 0 || seoEnFail > 0 || seoTrFail > 0 ? 1 : 0),
      businessesRetryable: businessHasError ? prev.businessesRetryable + 1 : prev.businessesRetryable,
      businessesStale: prev.businessesStale + (descStale > 0 || seoArStale > 0 || seoEnStale > 0 || seoTrStale > 0 ? 1 : 0),
      descriptionsGenerated: prev.descriptionsGenerated + descGen,
      seoArGenerated: prev.seoArGenerated + seoArGen,
      seoEnGenerated: prev.seoEnGenerated + seoEnGen,
      seoTrGenerated: prev.seoTrGenerated + seoTrGen,
      latestError: chunkLatestError ?? prev.latestError,
      lastRetryCount: maxRetry,
      totalDurationMs: prev.totalDurationMs + chunkDuration,
      status: "running",
      errorMessage: null,
      retryAttempt: 0,
      log,
    };

    await supabase
      .from("import_batches")
      .update({ metadata: { ...metadata, enrichment: patch } })
      .eq("id", data.id);

    const allDone = newProcessed >= totalBusinesses;
    if (allDone) {
      await advanceStage(supabase, data.id, "images");
    }

    return {
      ok: true,
      processed: chunk.length,
      descriptionsGenerated: descGen,
      seoGenerated: seoArGen + seoEnGen + seoTrGen,
      failed: descFailed + seoArFail + seoEnFail + seoTrFail,
      done: allDone,
    };
  });

// ---------- Detect schema (stage: detect_schema → field_mapping) ----------

async function invalidateApprovals(
  supabase: Sb,
  batchId: string,
  reason: string,
  kinds?: string[],
) {
  const q = supabase
    .from("import_approvals")
    .update({ invalidated_at: new Date().toISOString(), invalidation_reason: reason })
    .eq("batch_id", batchId)
    .is("invalidated_at", null);
  if (kinds && kinds.length > 0) q.in("approval_kind", kinds);
  await q;
}

export const detectImportSchema = createServerFn({ method: "POST" })
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
      .update({ status: "detecting", error_message: null })
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
    const fileHash = sha256Hex(text);
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
    const schema = detectSchema(payload);
    const schemaHash = computeSchemaHash(schema);
    const mapping = suggestFieldMapping(schema);
    const fieldMappingHash = computeFieldMappingHash(mapping);

    // Any file change (new schema_hash) invalidates existing approvals.
    const fileChanged = batch.file_hash && batch.file_hash !== fileHash;
    const schemaChanged = batch.schema_hash && batch.schema_hash !== schemaHash;
    if (fileChanged || schemaChanged) {
      await invalidateApprovals(supabase, data.id, "file_or_schema_changed");
    }

    await supabase
      .from("import_batches")
      .update({
        status: "schema_detected",
        file_hash: fileHash,
        detected_schema: schema,
        field_mapping: mapping,
        schema_hash: schemaHash,
        field_mapping_hash: fieldMappingHash,
        schema_detected_at: new Date().toISOString(),
        field_mapping_updated_at: new Date().toISOString(),
        field_mapping_approved_at: null,
        preview_hash: null,
        previewed_at: null,
      })
      .eq("id", data.id);
    await advanceStage(supabase, data.id, "field_mapping");
    return {
      ok: true,
      totalItems: schema.totalItems,
      fieldCount: schema.fields.length,
      schemaHash,
      fieldMappingHash,
    };
  });

export const updateImportFieldMapping = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id: string;
      edits: Array<{
        sourcePath: string;
        targetTable?: string | null;
        targetColumn?: string | null;
        transform?: string | null;
        status?: MappingRow["status"];
        reason?: string | null;
      }>;
    }) => {
      if (!i?.id) throw new Response("Missing id", { status: 400 });
      if (!Array.isArray(i.edits) || i.edits.length === 0)
        throw new Response("Missing edits", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("stage, field_mapping")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (!["field_mapping", "analyze"].includes(batch.stage))
      throw new Response(`Cannot edit mapping in stage ${batch.stage}`, { status: 400 });
    const base = (batch.field_mapping as MappingRow[] | null) ?? [];
    let next: MappingRow[];
    try {
      next = applyMappingEdits(base, data.edits);
    } catch (e) {
      throw new Response((e as Error).message, { status: 400 });
    }
    const newHash = computeFieldMappingHash(next);
    // Any edit invalidates the field_mapping approval and everything downstream.
    await invalidateApprovals(supabase, data.id, "field_mapping_edited");
    await supabase
      .from("import_batches")
      .update({
        field_mapping: next,
        field_mapping_hash: newHash,
        field_mapping_updated_at: new Date().toISOString(),
        field_mapping_approved_at: null,
        preview_hash: null,
        previewed_at: null,
      })
      .eq("id", data.id);
    // If we were in analyze, bounce back to field_mapping.
    if (batch.stage === "analyze") await advanceStage(supabase, data.id, "field_mapping");
    return { ok: true, fieldMappingHash: newHash };
  });

export const restoreSuggestedFieldMapping = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("stage, detected_schema")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (!batch.detected_schema)
      throw new Response("No detected schema — run detect first", { status: 400 });
    const mapping = suggestFieldMapping(batch.detected_schema);
    const hash = computeFieldMappingHash(mapping);
    await invalidateApprovals(supabase, data.id, "mapping_restored_to_suggested");
    await supabase
      .from("import_batches")
      .update({
        field_mapping: mapping,
        field_mapping_hash: hash,
        field_mapping_updated_at: new Date().toISOString(),
        field_mapping_approved_at: null,
      })
      .eq("id", data.id);
    return { ok: true, fieldMappingHash: hash };
  });

export const approveImportFieldMapping = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("stage, field_mapping, field_mapping_hash, schema_hash, file_hash")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (batch.stage !== "field_mapping")
      throw new Response(`Cannot approve mapping in stage ${batch.stage}`, { status: 400 });
    const mapping = (batch.field_mapping as MappingRow[] | null) ?? [];
    if (mapping.length === 0)
      throw new Response("No field mapping present — detect schema first", { status: 400 });
    // Enforce all required rows are still resolved.
    const unresolvedRequired = mapping.filter(
      (r) => r.required && (r.status !== "mapped" || !r.targetTable || !r.targetColumn),
    );
    if (unresolvedRequired.length > 0) {
      throw new Response(
        `Required fields unmapped: ${unresolvedRequired.map((r) => r.sourcePath).join(", ")}`,
        { status: 400 },
      );
    }
    // Invalidate prior field_mapping approvals then insert a fresh row.
    await invalidateApprovals(supabase, data.id, "superseded", ["field_mapping"]);
    const nowIso = new Date().toISOString();
    const { error: insErr } = await supabase.from("import_approvals").insert({
      batch_id: data.id,
      approval_kind: "field_mapping",
      artifact_hash: batch.field_mapping_hash,
      approved_by: context.userId,
      approved_at: nowIso,
      payload: {
        schema_hash: batch.schema_hash,
        file_hash: batch.file_hash,
        rowCount: mapping.length,
      },
    });
    if (insErr) throw new Response(insErr.message, { status: 400 });
    await supabase
      .from("import_batches")
      .update({
        status: "field_mapping_approved",
        field_mapping_approved_at: nowIso,
      })
      .eq("id", data.id);
    await advanceStage(supabase, data.id, "analyze");
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
    type CatMappingRow = { source_category: string; category_id: string | null; mapping_status: string };
    let mappingRows: CatMappingRow[] = [];
    if (catLabels.size > 0) {
      const { data: m } = await supabase
        .from("category_mappings")
        .select("source_category, category_id, mapping_status")
        .eq("source_provider", "google")
        .in("source_category", Array.from(catLabels));
      mappingRows = (m ?? []) as CatMappingRow[];
    }

    const { data: approvals } = await supabase
      .from("import_approvals")
      .select("id, approval_kind, artifact_hash, approved_at, approved_by, invalidated_at, invalidation_reason, payload")
      .eq("batch_id", data.id)
      .order("approved_at", { ascending: false });

    return {
      batch,
      items: items ?? [],
      provenance: provenance ?? [],
      mappings: mappingRows,
      storageExists,
      approvals: approvals ?? [],
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

    // Server-side gate: an active field_mapping approval must match the
    // current field_mapping_hash. Any file/mapping change invalidates it.
    if (batch.stage !== "analyze")
      throw new Response(
        `Cannot analyze in stage ${batch.stage}. Approve field mapping first.`,
        { status: 400 },
      );
    if (!batch.field_mapping_hash)
      throw new Response("Missing field_mapping_hash — detect + approve mapping first", {
        status: 400,
      });
    const { data: approval } = await supabase
      .from("import_approvals")
      .select("id, artifact_hash")
      .eq("batch_id", data.id)
      .eq("approval_kind", "field_mapping")
      .is("invalidated_at", null)
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!approval)
      throw new Response("Field mapping is not approved for this batch", { status: 400 });
    if (approval.artifact_hash !== batch.field_mapping_hash)
      throw new Response(
        "Field mapping changed since approval — re-approve before analysis",
        { status: 400 },
      );

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
    const fileHash = sha256Hex(text);
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
    const existingByPlaceId = new Map<string, Record<string, unknown>>();
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
        .eq("source_provider", "google")
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
    if (!["analyze", "mapping", "validation"].includes(batch.stage))
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
    if (batch.stage === "analyze" && labels.size === 0) {
      throw new Response("Run analysis before confirming category mappings", { status: 400 });
    }
    // Require every touched source label to be explicitly resolved. The importer must
    // never auto-approve category labels, and it must not advance while the admin still
    // has unresolved labels in the global category mapping queue.
    let pending = 0;
    let approved = 0;
    let ignored = 0;
    if (labels.size > 0) {
      const { data: rows } = await supabase
        .from("category_mappings")
        .select("source_category, mapping_status, category_id")
        .in("source_category", Array.from(labels))
        .eq("source_provider", "google");
      const byLabel = new Map<string, { source_category: string; mapping_status: string; category_id: string | null }>(
        (rows ?? []).map((r: { source_category: string; mapping_status: string; category_id: string | null }) =>
          [r.source_category, r] as [string, { source_category: string; mapping_status: string; category_id: string | null }],
        ),
      );
      labels.forEach((label) => {
        const r = byLabel.get(label);
        if (r?.mapping_status === "approved" && r.category_id) approved++;
        else if (r?.mapping_status === "ignored") ignored++;
        else pending++;
      });
    }
    if (pending > 0) {
      throw new Response(
        `${pending} category label${pending === 1 ? " is" : "s are"} still pending. Resolve them in Category mappings before continuing.`,
        { status: 409 },
      );
    }
    await advanceStage(supabase, data.id, "validation", { preview_hash: null, previewed_at: null, mapping_confirmed_at: new Date().toISOString() });
    return { ok: true, approvedMappings: approved, ignoredMappings: ignored, pendingMappings: pending };
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
    const { count: processedCount } = await supabase
      .from("import_batch_items")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", data.id)
      .not("processed_at", "is", null);
    if ((processedCount ?? 0) > 0) {
      throw new Response(
        "Cannot recompute preview after execution has started. Create a new batch instead.",
        { status: 409 },
      );
    }

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
    const lockOwner = `${context.userId}:runImportChunk`;
    const { data: batch } = await supabase
      .from("import_batches")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!batch) throw new Response("Not found", { status: 404 });
    if (!["preview", "execute"].includes(String(batch.stage)))
      throw new Response(`Batch is stage=${batch.stage}, cannot run`, { status: 400 });
    if (["completed", "partially_completed", "failed", "cancelled", "archived"].includes(String(batch.status))) {
      throw new Response(`Batch status=${batch.status}, cannot run`, { status: 400 });
    }
    if (!batch.preview_hash)
      throw new Response("Missing preview_hash — compute preview first", { status: 400 });

    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: lockRows, error: lockErr } = await supabase
      .from("import_batches")
      .update({
        processing_lock_at: new Date().toISOString(),
        processing_lock_by: lockOwner,
      })
      .eq("id", data.id)
      .or(`processing_lock_at.is.null,processing_lock_at.lt.${staleBefore}`)
      .select("id");
    if (lockErr) throw new Response(`Could not acquire import lock: ${lockErr.message}`, { status: 500 });
    if (!lockRows || lockRows.length === 0) {
      throw new Response("Import batch is already processing. Wait for the current chunk to finish.", {
        status: 409,
      });
    }

    // TEMPORARY: test import limit — stop if N records already processed across chunks
    if (TEST_IMPORT_LIMIT > 0) {
      const { count: alreadyProcessed } = await supabase
        .from("import_batch_items")
        .select("id", { count: "exact", head: true })
        .eq("import_batch_id", data.id)
        .in("status", ["inserted", "updated"]);
      if ((alreadyProcessed ?? 0) >= TEST_IMPORT_LIMIT) {
        await clearImportLock(supabase, data.id, lockOwner);
        return {
          ok: true,
          processed: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          reviewsWritten: 0,
          imagesWritten: 0,
          done: true,
          testLimitHit: true as const,
        };
      }
    }

    // Load next chunk of pending items whose preview_hash still matches.
    const { data: items } = await supabase
      .from("import_batch_items")
      .select("*")
      .eq("import_batch_id", data.id)
      .eq("status", "pending")
      .is("processed_at", null)
      .eq("preview_hash", batch.preview_hash)
      .order("item_index")
      .limit(TEST_IMPORT_LIMIT > 0 ? Math.min(TEST_IMPORT_LIMIT, CHUNK_SIZE) : CHUNK_SIZE);

    if (!items || items.length === 0) {
      // Nothing runnable — either done or stale.
      const { count: stale } = await supabase
        .from("import_batch_items")
        .select("id", { count: "exact", head: true })
        .eq("import_batch_id", data.id)
        .eq("status", "pending")
        .is("processed_at", null)
        .neq("preview_hash", batch.preview_hash);
      if ((stale ?? 0) > 0) {
        await clearImportLock(supabase, data.id, lockOwner);
        return { ok: false, processed: 0, done: false, staleItems: stale, needsRepreview: true };
      }
      await finalizeExecute(supabase, data.id);
      await clearImportLock(supabase, data.id, lockOwner);
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
      mappingIndex.set(m.source_category.toLowerCase().trim(), m.category_id);
    });

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let reviewsWritten = 0;
    let imagesWritten = 0;
    for (const item of items) {
      if (TEST_IMPORT_LIMIT > 0 && (inserted + updated + skipped + failed) >= TEST_IMPORT_LIMIT) break;
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
          ? mappingIndex.get(normalized.primaryCategorySource) ??
            mappingIndex.get(normalized.primaryCategorySource.toLowerCase().trim()) ??
            null
          : null;
        if (requireCategoryMapping && !primaryCatId) {
          await markItem(supabase, item.id, "needs_mapping", "needs_mapping", "unmapped_category");
          skipped++;
          continue;
        }

        const { data: existing } = await supabase
          .from("businesses")
          .select("id, name, slug, field_sources, status, source")
          .eq("place_id", normalized.placeId)
          .maybeSingle();
        let businessIdForChildren: string | null = existing?.id ?? null;

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
          if (appliedFields.length > 0) {
            patch.field_sources = fieldSources;
            const { error: uErr } = await supabase
              .from("businesses")
              .update(patch)
              .eq("id", existing.id);
            if (uErr) throw uErr;
            updated++;
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
            const reason = intent !== "noop" ? "no_fields_approved" : "noop";
            await recordProvenance(supabase, existing.id, item.import_batch_id, item.id, "noop", []);
            await markItem(supabase, item.id, "skipped", "skip", reason, existing.id);
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
          businessIdForChildren = businessId;
          inserted++;
          await recordProvenance(supabase, businessId, item.import_batch_id, item.id, "insert", appliedFields);
          await markItem(supabase, item.id, "inserted", "insert", null, businessId);
        }

        if (!businessIdForChildren) throw new Error("import_item_missing_business_id");

        // Opening hours: replace only for inserts / when explicitly approved.
        if (!existing && normalized.openingHours.length > 0) {
          const { error: hoursDeleteErr } = await supabase
            .from("business_opening_hours")
            .delete()
            .eq("business_id", businessIdForChildren);
          if (hoursDeleteErr) throw new Error(`opening_hours_delete_failed: ${hoursDeleteErr.message}`);
          const hoursRows = normalized.openingHours.map((h) => ({
            business_id: businessIdForChildren,
            day_of_week: h.dayOfWeek,
            open_time: h.openTime,
            close_time: h.closeTime,
            is_closed: h.isClosed,
          }));
          const { error: hoursInsertErr } = await supabase.from("business_opening_hours").insert(hoursRows);
          if (hoursInsertErr) throw new Error(`opening_hours_insert_failed: ${hoursInsertErr.message}`);
        }

        // Images / reviews — always upserted from source (idempotent).
        if (normalized.images.length > 0) {
          if (normalized.images.some((img) => img.isCover)) {
            const { error: coverResetErr } = await supabase
              .from("business_images")
              .update({ is_cover: false })
              .eq("business_id", businessIdForChildren)
              .eq("source_type", "google_places");
            if (coverResetErr) throw new Error(`image_cover_reset_failed: ${coverResetErr.message}`);
          }
          for (const img of normalized.images) {
            const { error: imgErr } = await supabase.from("business_images").upsert(
              {
                business_id: businessIdForChildren,
                place_id: normalized.placeId,
                source_url: img.sourceUrl,
                source_fingerprint: img.sourceFingerprint,
                source_metadata: img.sourceMetadata,
                source_provider: "google",
                source_type: "google_places",
                sort_order: img.sortOrder,
                is_cover: img.isCover,
                google_photo_category: img.googleCategory,
                google_photo_labels: img.googleLabels ?? [],
                storage_status: img.sourceUrl ? "external_only" : "pending",
                width: img.width ?? null,
                height: img.height ?? null,
                image_type: img.isCover ? "cover" : "gallery",
                deleted_at: null,
              },
              { onConflict: "business_id,source_fingerprint" },
            );
            if (imgErr) throw new Error(`image_upsert_failed: ${imgErr.message}`);
            imagesWritten++;
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
            if (revErr) throw new Error(`review_upsert_failed: ${revErr.message}`);
            reviewsWritten++;
          }
        }

        const catIds = Array.from(
          new Set(
            [
              primaryCatId,
              ...normalized.categoriesSource.map(
                (c) => mappingIndex.get(c) ?? mappingIndex.get(c.toLowerCase().trim()) ?? null,
              ),
            ].filter(
              (x): x is string => !!x,
            ),
          ),
        );
        const maySyncImportOwnedCategories =
          !existing || String(existing.source ?? "") === "google_json";
        if (maySyncImportOwnedCategories && catIds.length > 0) {
          const { error: categoryDeleteErr } = await supabase
            .from("business_category_links")
            .delete()
            .eq("business_id", businessIdForChildren);
          if (categoryDeleteErr) throw new Error(`category_links_delete_failed: ${categoryDeleteErr.message}`);
          const links = catIds.map((cid) => ({
            business_id: businessIdForChildren,
            category_id: cid,
            is_primary: cid === primaryCatId,
          }));
          const { error: categoryInsertErr } = await supabase
            .from("business_category_links")
            .upsert(links, { onConflict: "business_id,category_id" });
          if (categoryInsertErr) throw new Error(`category_links_insert_failed: ${categoryInsertErr.message}`);
          if (existing && primaryCatId) {
            const { error: primaryCategoryErr } = await supabase
              .from("businesses")
              .update({
                primary_category_id: primaryCatId,
                field_sources: {
                  ...fieldSources,
                  primary_category_id: { source: "import", updated_at: nowIso },
                },
              })
              .eq("id", businessIdForChildren);
            if (primaryCategoryErr) {
              throw new Error(`primary_category_update_failed: ${primaryCategoryErr.message}`);
            }
          }
        }
      } catch (e) {
        failed++;
        await markItem(supabase, item.id, "failed", null, (e as Error).message?.slice(0, 400) ?? "error");
      }
    }

    await supabase.rpc("record_audit", {
      _action: "import.chunk",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: null,
      _metadata: { inserted, updated, skipped, failed, imagesWritten, reviewsWritten, chunk_size: items.length },
    });

    const { data: allItemsForCounts } = await supabase
      .from("import_batch_items")
      .select("status, processed_at")
      .eq("import_batch_id", data.id);
    const statusRows = (allItemsForCounts ?? []) as Array<{ status: string; processed_at: string | null }>;
    await supabase
      .from("import_batches")
      .update({
        inserted_items: statusRows.filter((row) => row.status === "inserted").length,
        updated_items: statusRows.filter((row) => row.status === "updated").length,
        skipped_items: statusRows.filter((row) => row.status === "skipped").length,
        failed_items: statusRows.filter((row) => row.status === "failed").length,
        processed_items: statusRows.filter((row) => row.processed_at != null).length,
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
    await clearImportLock(supabase, data.id, lockOwner);

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
    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .select("failed_items, invalid_items, status, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (batchError) throw new Response(batchError.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    if ((batch.failed_items ?? 0) > 0 || (batch.invalid_items ?? 0) > 0) {
      throw new Response(
        `Cannot enqueue translations for batch with ${batch.failed_items ?? 0} failed and ${batch.invalid_items ?? 0} invalid items.`,
        { status: 409 },
      );
    }
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
    await advanceStage(supabase, data.id, "enrich");
    return { ok: true, enqueued, failed, businesses: businessIds.length };
  });

export const skipBatchTranslations = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch, error } = await supabase
      .from("import_batches")
      .select("failed_items, invalid_items, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    if ((batch.failed_items ?? 0) > 0 || (batch.invalid_items ?? 0) > 0) {
      throw new Response(
        `Cannot skip translations for a batch with ${batch.failed_items ?? 0} failed and ${
          batch.invalid_items ?? 0
        } invalid items.`,
        { status: 409 },
      );
    }
    if (batch.stage !== "translations") {
      throw new Response(`Cannot skip translations in stage ${batch.stage}`, { status: 400 });
    }
    await advanceStage(supabase, data.id, "enrich");
    await supabase.rpc("record_audit", {
      _action: "import.translations.skip",
      _entity_type: "import_batch",
      _entity_id: data.id,
      _before: null,
      _after: null,
      _metadata: { reason: "manual_skip" },
    });
    return { ok: true };
  });

export const markImagesStageDone = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Missing id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: batch, error } = await supabase
      .from("import_batches")
      .select("failed_items, invalid_items, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    if ((batch.failed_items ?? 0) > 0 || (batch.invalid_items ?? 0) > 0) {
      throw new Response(
        `Cannot advance images for a batch with ${batch.failed_items ?? 0} failed and ${
          batch.invalid_items ?? 0
        } invalid items.`,
        { status: 409 },
      );
    }
    if (batch.stage !== "images") {
      throw new Response(`Cannot advance images in stage ${batch.stage}`, { status: 400 });
    }
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
    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .select("failed_items, invalid_items, status, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (batchError) throw new Response(batchError.message, { status: 500 });
    if (!batch) throw new Response("Not found", { status: 404 });
    if ((batch.failed_items ?? 0) > 0 || (batch.invalid_items ?? 0) > 0) {
      throw new Response(
        `Cannot publish batch with ${batch.failed_items ?? 0} failed and ${batch.invalid_items ?? 0} invalid items.`,
        { status: 409 },
      );
    }
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

async function clearImportLock(supabase: Sb, id: string, lockOwner: string) {
  await supabase
    .from("import_batches")
    .update({ processing_lock_at: null, processing_lock_by: null })
    .eq("id", id)
    .eq("processing_lock_by", lockOwner);
}

async function recordProvenance(
  supabase: Sb,
  businessId: string,
  batchId: string,
  itemId: string,
  action: "insert" | "update" | "noop",
  fields: string[],
) {
  await supabase
    .from("business_import_provenance")
    .delete()
    .eq("import_batch_item_id", itemId);
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

// ---------- Reprocess images for existing batch ----------
/**
 * Re-extract and upsert business_images rows for every item in a batch that
 * already has a linked business_id. Used to backfill after fixing the
 * normalizer (e.g., accept bare URL strings or Google photo references).
 * Idempotent via onConflict=(business_id, source_fingerprint).
 */
export const reprocessBatchImages = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: items, error } = await supabase
      .from("import_batch_items")
      .select("id, business_id, raw_payload")
      .eq("import_batch_id", data.batchId)
      .not("business_id", "is", null);
    if (error) throw new Response(error.message, { status: 500 });

    let itemsScanned = 0;
    let imagesUpserted = 0;
    let itemsWithImages = 0;

    for (const it of items ?? []) {
      itemsScanned++;
      const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
      const source = (rp.source as Record<string, unknown> | undefined) ?? null;
      if (!source) continue;
      const unwrapped = unwrapRecord(source);
      const images = normalizeImages(unwrapped);
      if (images.length === 0) continue;
      itemsWithImages++;
      if (images.some((img) => img.isCover)) {
        const { error: coverResetErr } = await supabase
          .from("business_images")
          .update({ is_cover: false })
          .eq("business_id", it.business_id as string)
          .eq("source_type", "google_places");
        if (coverResetErr) throw new Error(`image_cover_reset_failed: ${coverResetErr.message}`);
      }
      for (const img of images) {
        const { error: imgErr } = await supabase.from("business_images").upsert(
          {
            business_id: it.business_id as string,
            place_id: String(unwrapped.place_id ?? unwrapped.placeId ?? unwrapped.id ?? ""),
            source_url: img.sourceUrl,
            source_fingerprint: img.sourceFingerprint,
            source_metadata: img.sourceMetadata,
            source_provider: "google",
            source_type: "google_places",
            sort_order: img.sortOrder,
            is_cover: img.isCover,
            google_photo_category: img.googleCategory,
            google_photo_labels: img.googleLabels ?? [],
            storage_status: img.sourceUrl ? "external_only" : "pending",
            width: img.width ?? null,
            height: img.height ?? null,
            image_type: img.isCover ? "cover" : "gallery",
            deleted_at: null,
          },
          { onConflict: "business_id,source_fingerprint" },
        );
        if (imgErr) throw new Error(`image_upsert_failed: ${imgErr.message}`);
        imagesUpserted++;
      }
    }

    await supabase.rpc("record_audit", {
      _action: "import.reprocess_images",
      _entity_type: "import_batch",
      _entity_id: data.batchId,
      _before: null,
      _after: null,
      _metadata: { itemsScanned, itemsWithImages, imagesUpserted },
    });

    return { ok: true, itemsScanned, itemsWithImages, imagesUpserted };
  });

// ---------- Reprocess reviews for existing batch ----------
/**
 * Re-extract and upsert reviews rows for every item in a batch that already
 * has a linked business_id. Google-sourced reviews are stored as
 * status='published' (external, moderated by Google). Idempotent via
 * onConflict=(business_id, source, source_fingerprint).
 */
export const reprocessBatchReviews = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: items, error } = await supabase
      .from("import_batch_items")
      .select("id, business_id, raw_payload")
      .eq("import_batch_id", data.batchId)
      .not("business_id", "is", null);
    if (error) throw new Response(error.message, { status: 500 });

    let itemsScanned = 0;
    let itemsWithReviews = 0;
    let reviewsUpserted = 0;

    for (const it of items ?? []) {
      itemsScanned++;
      const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
      const source = (rp.source as Record<string, unknown> | undefined) ?? null;
      if (!source) continue;
      const unwrapped = unwrapRecord(source);
      const reviews = normalizeReviews(unwrapped);
      if (reviews.length === 0) continue;
      itemsWithReviews++;
      for (const rv of reviews) {
        const { error: rErr } = await supabase.from("reviews").upsert(
          {
            business_id: it.business_id as string,
            source: "google",
            external_review_id: rv.externalReviewId,
            source_fingerprint: rv.sourceFingerprint,
            author_name: rv.authorName,
            author_avatar_url: rv.authorAvatarUrl,
            rating: rv.rating,
            review_text: rv.reviewText,
            review_language: rv.reviewLanguage,
            review_date: rv.reviewDate,
            status: "published",
          },
          { onConflict: "business_id,source,source_fingerprint" },
        );
        if (rErr) throw new Error(`review_upsert_failed: ${rErr.message}`);
        reviewsUpserted++;
      }
    }

    await supabase.rpc("record_audit", {
      _action: "import.reprocess_reviews",
      _entity_type: "import_batch",
      _entity_id: data.batchId,
      _before: null,
      _after: null,
      _metadata: { itemsScanned, itemsWithReviews, reviewsUpserted },
    });

    return { ok: true, itemsScanned, itemsWithReviews, reviewsUpserted };
  });

