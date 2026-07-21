import { useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createImportBatch,
  listImportBatches,
  cancelImportBatch,
  markImportBatchUploaded,
  markImportBatchFailed,
  deleteImportBatch,
  archiveImportBatch,
  detectImportSchema,
  approveImportFieldMapping,
  analyzeImportBatch,
  confirmImportMappings,
  computeImportPreview,
  runImportChunk,
  enqueueBatchTranslations,
  markImagesStageDone,
  publishImportBatch,
} from "@/lib/admin/imports.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/imports")({
  ssr: false,
  component: ImportsPage,
});

type BatchRow = Record<string, unknown> & {
  id: string;
  status: string;
  stage: string;
};

const STAGE_ORDER = [
  "upload",
  "detect_schema",
  "field_mapping",
  "analyze",
  "mapping",
  "validation",
  "preview",
  "execute",
  "translations",
  "images",
  "publish",
  "completed",
] as const;

const STAGE_LABEL: Record<string, string> = {
  upload: "1. Upload",
  detect_schema: "2. Detect schema",
  field_mapping: "3. Field mapping",
  analyze: "4. Analyze",
  mapping: "5. Category mapping",
  validation: "6. Validation",
  preview: "7. Preview",
  execute: "8. Execute",
  translations: "9. Translations",
  images: "10. Images",
  publish: "11. Publish",
  completed: "12. Completed",
};

const STAGE_SHORT: Record<string, string> = {
  upload: "Upload",
  detect_schema: "Schema",
  field_mapping: "Field map",
  analyze: "Analyze",
  mapping: "Cat map",
  validation: "Validate",
  preview: "Preview",
  execute: "Execute",
  translations: "Translate",
  images: "Images",
  publish: "Publish",
  completed: "Done",
};

function ImportsPage() {
  const { lang } = Route.useParams();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin", "imports"],
    queryFn: () => listImportBatches(),
    refetchInterval: 4000,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelImportBatch({ data: { id } }),
    onSuccess: () => {
      toast.success("Cancelled");
      qc.invalidateQueries({ queryKey: ["admin", "imports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteImportBatch({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin", "imports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveImportBatch({ data: { id } }),
    onSuccess: () => {
      toast.success("Archived");
      qc.invalidateQueries({ queryKey: ["admin", "imports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    let batchId: string | null = null;
    try {
      if (!/\.json$/i.test(file.name) && file.type && !/json/i.test(file.type)) {
        throw new Error(`Not a JSON file: ${file.name}`);
      }
      if (file.size > 200 * 1024 * 1024) {
        throw new Error(`File exceeds 200MB (${Math.round(file.size / 1024 / 1024)}MB)`);
      }
      const res = await createImportBatch({
        data: {
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || "application/json",
        },
      });
      batchId = res.batchId;
      const up = await fetch(res.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/json" },
        body: file,
      });
      if (!up.ok) {
        const body = await up.text().catch(() => "");
        throw new Error(`Storage PUT ${up.status}: ${body.slice(0, 200) || up.statusText}`);
      }
      await markImportBatchUploaded({ data: { id: batchId } });
      toast.success("Uploaded");
      qc.invalidateQueries({ queryKey: ["admin", "imports"] });
      window.location.assign(`/${lang}/admin/imports/${batchId}`);
    } catch (e) {
      const msg = (e as Error).message ?? "Upload failed";
      setUploadError(msg);
      toast.error(msg);
      if (batchId) {
        try {
          await markImportBatchFailed({
            data: { id: batchId, step: "upload", message: msg },
          });
          qc.invalidateQueries({ queryKey: ["admin", "imports"] });
        } catch {
          /* already surfaced */
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const rows = (q.data?.rows ?? []) as BatchRow[];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Imports</h1>
          <p className="text-sm text-muted-foreground">
            12-stage workflow — each stage waits for you. Click{" "}
            <span className="font-medium text-foreground">Next: …</span> on a card to advance one step.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : "Upload JSON"}
          </Button>
        </div>
      </div>
      {uploadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="font-medium">Upload failed</div>
          <div className="mt-1 text-xs">{uploadError}</div>
        </div>
      )}
      <div className="space-y-3">
        {rows.length === 0 && (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
            No imports yet
          </div>
        )}
        {rows.map((b) => (
          <ImportCard
            key={b.id}
            batch={b}
            lang={lang}
            onCancel={() => cancelMut.mutate(b.id)}
            onDelete={() => {
              if (confirm(`Delete ${String(b.original_filename)}? This cannot be undone.`))
                deleteMut.mutate(b.id);
            }}
            onArchive={() => archiveMut.mutate(b.id)}
          />
        ))}
      </div>
    </div>
  );
}

type NextActionSpec = {
  label: string;
  description: string;
  run: (id: string) => Promise<unknown>;
  successMessage: string;
  next?:
    | {
        kind: "detail";
        tab:
          | "schema"
          | "field_mapping"
          | "analysis"
          | "categories"
          | "validation"
          | "import"
          | "translations"
          | "images"
          | "overview";
      }
    | { kind: "categoryMappings" };
};

const NEXT_ACTIONS: Record<string, NextActionSpec> = {
  detect_schema: {
    label: "Detect schema",
    description: "Scan the uploaded JSON and build the field inventory.",
    successMessage: "Schema detected — opening Field map.",
    next: { kind: "detail", tab: "field_mapping" },
    run: (id) => detectImportSchema({ data: { id } }),
  },
  field_mapping: {
    label: "Approve field mapping",
    description: "Lock in the source → target field mapping and unlock analysis.",
    successMessage: "Field mapping approved — opening Analysis.",
    next: { kind: "detail", tab: "analysis" },
    run: (id) => approveImportFieldMapping({ data: { id } }),
  },
  analyze: {
    label: "Run analysis",
    description: "Normalize records, then review discovered category labels in the next stage.",
    successMessage: "Analysis complete — opening Category mappings for this batch.",
    next: { kind: "categoryMappings" },
    run: (id) => analyzeImportBatch({ data: { id } }),
  },
  mapping: {
    label: "Continue after category mapping",
    description: "Approve or ignore source category labels first, then continue to validation.",
    successMessage: "Category mappings confirmed — opening Validation.",
    next: { kind: "detail", tab: "validation" },
    run: (id) => confirmImportMappings({ data: { id } }),
  },
  validation: {
    label: "Compute preview",
    description: "Diff every record against the database (inserts / updates / noops).",
    successMessage: "Preview computed — opening Import Preview.",
    next: { kind: "detail", tab: "import" },
    run: (id) => computeImportPreview({ data: { id } }),
  },
  preview: {
    label: "Compute preview",
    description: "Diff every record against the database (inserts / updates / noops).",
    successMessage: "Preview computed — opening Import Preview.",
    next: { kind: "detail", tab: "import" },
    run: (id) => computeImportPreview({ data: { id } }),
  },
  execute: {
    label: "Run next chunk",
    description: "Write the next batch of approved records to the database.",
    successMessage: "Import chunk finished — opening execution details.",
    next: { kind: "detail", tab: "import" },
    run: (id) => runImportChunk({ data: { id } }),
  },
  translations: {
    label: "Enqueue translations",
    description: "Queue TR/EN/AR translation jobs for imported businesses.",
    successMessage: "Translations queued — opening Images.",
    next: { kind: "detail", tab: "images" },
    run: (id) => enqueueBatchTranslations({ data: { id } }),
  },
  images: {
    label: "Mark images done",
    description: "Image pipeline is blocked; advance past this stage to publish.",
    successMessage: "Images stage advanced — opening Publish step.",
    next: { kind: "detail", tab: "overview" },
    run: (id) => markImagesStageDone({ data: { id } }),
  },
  publish: {
    label: "Publish",
    description: "Flip imported businesses from pending review to published.",
    successMessage: "Import published — completed.",
    next: { kind: "detail", tab: "overview" },
    run: (id) => publishImportBatch({ data: { id } }),
  },
};

function ImportCard({
  batch,
  lang,
  onCancel,
  onDelete,
  onArchive,
}: {
  batch: BatchRow;
  lang: string;
  onCancel: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const stage = String(batch.stage ?? "upload");
  const status = String(batch.status ?? "pending");
  const total = Number(batch.total_items ?? 0);
  const processed = Number(batch.processed_items ?? 0);
  const inserted = Number(batch.inserted_items ?? 0);
  const updated = Number(batch.updated_items ?? 0);
  const skipped = Number(batch.skipped_items ?? 0);
  const failed = Number(batch.failed_items ?? 0);
  const invalid = Number(batch.invalid_items ?? 0);
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const canDelete = !["execute", "translations", "images", "publish", "completed"].includes(stage);
  const canArchive =
    status !== "archived" &&
    ["completed", "partially_completed", "failed", "cancelled"].includes(status);

  const nextSpec = NEXT_ACTIONS[stage];
  const nextMut = useMutation({
    mutationFn: () => nextSpec!.run(batch.id),
    onSuccess: async () => {
      toast.success(nextSpec!.successMessage);
      await qc.invalidateQueries({ queryKey: ["admin", "imports"] });
      if (nextSpec!.next?.kind === "categoryMappings") {
        navigate({
          to: "/$lang/admin/category-mappings",
          params: { lang },
          search: { batchId: batch.id, returnTo },
        });
      } else if (nextSpec!.next?.kind === "detail") {
        navigate({
          to: "/$lang/admin/imports/$id",
          params: { lang, id: batch.id },
          search: { tab: nextSpec!.next.tab },
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentIdx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  const schemaReached = currentIdx >= STAGE_ORDER.indexOf("field_mapping");
  const mappingReached = currentIdx >= STAGE_ORDER.indexOf("field_mapping");
  const categoryMappingReached = currentIdx >= STAGE_ORDER.indexOf("mapping");
  const returnTo = `/${lang}/admin/imports/${batch.id}?tab=categories`;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/$lang/admin/imports/$id"
              params={{ lang, id: batch.id }}
              className="text-lg font-semibold hover:underline"
            >
              {String(batch.original_filename ?? "(no name)")}
            </Link>
            <StagePill stage={stage} />
            <StatusPill status={status} />
            {nextSpec && (
              <span className="inline-flex rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                Waiting for you
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {new Date(String(batch.created_at)).toLocaleString()} ·{" "}
            {Math.round(Number(batch.file_size ?? 0) / 1024)} KB
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button asChild size="sm" variant="outline">
            <Link to="/$lang/admin/imports/$id" params={{ lang, id: batch.id }}>
              Open
            </Link>
          </Button>
          {schemaReached && (
            <Button asChild size="sm" variant="outline">
              <Link
                to="/$lang/admin/imports/$id"
                params={{ lang, id: batch.id }}
                search={{ tab: "schema" }}
              >
                Schema
              </Link>
            </Button>
          )}
          {mappingReached && (
            <Button asChild size="sm" variant="outline">
              <Link
                to="/$lang/admin/imports/$id"
                params={{ lang, id: batch.id }}
                search={{ tab: "field_mapping" }}
              >
                Field map
              </Link>
            </Button>
          )}
          {categoryMappingReached && (
            <Button asChild size="sm" variant="outline">
              <Link
                to="/$lang/admin/category-mappings"
                params={{ lang }}
                search={{ batchId: batch.id, returnTo }}
              >
                Category mappings
              </Link>
            </Button>
          )}
          {["uploaded", "analyzing", "ready", "importing"].includes(status) && (
            <Button size="sm" variant="destructive" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="outline" onClick={onDelete}>
              Delete
            </Button>
          )}
          {canArchive && (
            <Button size="sm" variant="outline" onClick={onArchive}>
              Archive
            </Button>
          )}
        </div>
      </div>

      {nextSpec && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-primary/50 bg-primary/5 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              Next step · {STAGE_LABEL[stage] ?? stage}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">{nextSpec.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{nextSpec.description}</div>
          </div>
          <Button onClick={() => nextMut.mutate()} disabled={nextMut.isPending}>
            {nextMut.isPending ? `${nextSpec.label}…` : `Next: ${nextSpec.label}`}
          </Button>
        </div>
      )}

      <StageStepper stage={stage} />

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
        <Metric label="Total" value={total} />
        <Metric label="Inserted" value={inserted} tone="success" />
        <Metric label="Updated" value={updated} tone="info" />
        <Metric label="Skipped" value={skipped} tone="warning" />
        <Metric label="Failed" value={failed} tone="danger" />
        <Metric label="Invalid" value={invalid} tone="danger" />
      </div>
      {total > 0 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all ${
              failed > 0 ? "bg-destructive" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {batch.error_message ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {String(batch.error_message)}
        </div>
      ) : null}
    </div>
  );
}

function StageStepper({ stage }: { stage: string }) {
  const currentIdx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return (
    <div className="mt-3 overflow-x-auto">
      <ol className="flex min-w-full items-center gap-1">
        {STAGE_ORDER.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          const dotCls = done
            ? "bg-primary text-primary-foreground border-primary"
            : active
              ? "bg-primary/15 text-primary border-primary"
              : "bg-muted text-muted-foreground border-border";
          const labelCls = active
            ? "text-primary font-semibold"
            : done
              ? "text-foreground"
              : "text-muted-foreground";
          return (
            <li key={s} className="flex min-w-0 flex-1 items-center gap-1">
              <div className="flex flex-col items-center gap-1 min-w-0">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${dotCls}`}
                >
                  {done ? "✓" : i + 1}
                </div>
                <div className={`text-[9px] leading-tight text-center truncate max-w-[70px] ${labelCls}`}>
                  {STAGE_SHORT[s] ?? s}
                </div>
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <div
                  className={`h-px flex-1 ${i < currentIdx ? "bg-primary" : "bg-border"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "success" | "info" | "warning" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "text-emerald-600"
      : tone === "info"
        ? "text-blue-600"
        : tone === "warning"
          ? "text-amber-600"
          : tone === "danger"
            ? "text-destructive"
            : "";
  return (
    <div className="rounded-md border bg-background/50 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function StagePill({ stage }: { stage: string }) {
  return (
    <span className="inline-flex rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-medium">
      {STAGE_LABEL[stage] ?? stage}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    uploaded: "bg-blue-100 text-blue-700",
    analyzing: "bg-blue-100 text-blue-700",
    ready: "bg-amber-100 text-amber-700",
    mapping: "bg-amber-100 text-amber-700",
    previewing: "bg-amber-100 text-amber-700",
    previewed: "bg-emerald-100 text-emerald-700",
    awaiting_approval: "bg-amber-100 text-amber-700",
    importing: "bg-blue-100 text-blue-700",
    publishing: "bg-amber-100 text-amber-700",
    completed: "bg-emerald-100 text-emerald-700",
    partially_completed: "bg-amber-100 text-amber-700",
    failed: "bg-destructive/10 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] ${tone[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}
