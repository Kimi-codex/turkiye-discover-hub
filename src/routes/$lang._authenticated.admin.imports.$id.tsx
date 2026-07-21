import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeImportBatch,
  computeImportPreview,
  confirmImportMappings,
  enqueueBatchTranslations,
  getImportBatch,
  markImagesStageDone,
  publishImportBatch,
  runImportChunk,
  setImportItemApproval,
  cancelImportBatch,
  detectImportSchema,
  updateImportFieldMapping,
  restoreSuggestedFieldMapping,
  approveImportFieldMapping,
} from "@/lib/admin/imports.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { IMPORTABLE_FIELDS } from "@/lib/import/preview";
import type { MappingRow } from "@/lib/import/schema-detector";

export const Route = createFileRoute("/$lang/_authenticated/admin/imports/$id")({
  ssr: false,
  component: ImportDetailPage,
  validateSearch: (s: Record<string, unknown>): { tab?: TabId } => {
    const t = s?.tab as string | undefined;
    return t && TAB_IDS.includes(t as TabId) ? { tab: t as TabId } : {};
  },
});

const TAB_IDS = [
  "overview",
  "schema",
  "field_mapping",
  "analysis",
  "categories",
  "validation",
  "import",
  "translations",
  "images",
  "logs",
] as const;
type TabId = (typeof TAB_IDS)[number];

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

const STAGE_TAB: Record<string, TabId> = {
  upload: "overview",
  detect_schema: "schema",
  field_mapping: "field_mapping",
  analyze: "analysis",
  mapping: "categories",
  validation: "validation",
  preview: "import",
  execute: "import",
  translations: "translations",
  images: "images",
  publish: "overview",
  completed: "overview",
};

function ImportDetailPage() {
  const { lang, id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const currentTab: TabId = search.tab ?? "overview";
  const qc = useQueryClient();
  const [autoRun, setAutoRun] = useState(false);

  const q = useQuery({
    queryKey: ["admin", "import", id],
    queryFn: () => getImportBatch({ data: { id } }),
    refetchInterval: 2500,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "import", id] });

  const analyzeMut = useMutation({
    mutationFn: () => analyzeImportBatch({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Analyzed: ${r.valid} valid / ${r.invalid} invalid (${r.format})`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmMappingMut = useMutation({
    mutationFn: () => confirmImportMappings({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Mapping confirmed: ${r.approvedMappings} approved / ${r.pendingMappings} still pending`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewMut = useMutation({
    mutationFn: () => computeImportPreview({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Preview: ${r.inserts} inserts, ${r.updates} updates, ${r.noops} noops`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMut = useMutation({
    mutationFn: () => runImportChunk({ data: { id } }),
    onSuccess: (res) => {
      invalidate();
      if (res.needsRepreview) {
        setAutoRun(false);
        toast.warning("Stale preview — re-run preview.");
        return;
      }
      if (autoRun && !res.done) {
        setTimeout(() => runMut.mutate(), 250);
      } else if (res.done) {
        setAutoRun(false);
        toast.success("Execute stage complete");
      }
    },
    onError: (e: Error) => {
      setAutoRun(false);
      toast.error(e.message);
    },
  });

  const translationsMut = useMutation({
    mutationFn: () => enqueueBatchTranslations({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Enqueued translations for ${r.businesses} businesses (${r.enqueued} ok, ${r.failed} failed)`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const imagesDoneMut = useMutation({
    mutationFn: () => markImagesStageDone({ data: { id } }),
    onSuccess: () => {
      toast.info("Image pipeline is Blocked by configuration; advanced to publish.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishMut = useMutation({
    mutationFn: () => publishImportBatch({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Published ${r.published} of ${r.businesses} businesses`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelImportBatch({ data: { id } }),
    onSuccess: invalidate,
  });

  const setApprovalMut = useMutation({
    mutationFn: (v: { itemId: string; approvedFields: string[] }) =>
      setImportItemApproval({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (q.error) return <div className="p-6 text-sm text-destructive">{(q.error as Error).message}</div>;
  const batch = q.data!.batch as Record<string, unknown>;
  const items = q.data!.items as Array<Record<string, unknown>>;
  const provenance = q.data!.provenance as Array<Record<string, unknown>>;
  const mappings = q.data!.mappings as Array<{ source_category: string; category_id: string | null; mapping_status: string }>;
  const storageExists = q.data!.storageExists as boolean;
  const approvals = (q.data as { approvals?: Array<Record<string, unknown>> }).approvals ?? [];
  const stage = String(batch.stage ?? "upload");
  const status = String(batch.status ?? "");
  const detectedSchema = (batch.detected_schema as import("@/lib/import/schema-detector").DetectedSchema | null) ?? null;
  const fieldMapping = (batch.field_mapping as MappingRow[] | null) ?? [];
  const fieldMappingHash = String(batch.field_mapping_hash ?? "");
  const activeFmApproval = approvals.find(
    (a) => a.approval_kind === "field_mapping" && a.invalidated_at == null,
  );
  const isFmApproved =
    !!activeFmApproval && activeFmApproval.artifact_hash === fieldMappingHash;

  const setTab = (tab: TabId) =>
    navigate({ search: (prev: { tab?: TabId }) => ({ ...prev, tab }), replace: true });

  const detectMut = useMutation({
    mutationFn: () => detectImportSchema({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Detected ${r.fieldCount} fields across ${r.totalItems} items`);
      invalidate();
      setTab("field_mapping");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const approveMappingMut = useMutation({
    mutationFn: () => approveImportFieldMapping({ data: { id } }),
    onSuccess: () => {
      toast.success("Field mapping approved — analysis unlocked");
      invalidate();
      setTab("analysis");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restoreMappingMut = useMutation({
    mutationFn: () => restoreSuggestedFieldMapping({ data: { id } }),
    onSuccess: () => {
      toast.success("Restored suggested mapping");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const editMappingMut = useMutation({
    mutationFn: (edits: Array<Partial<MappingRow> & { sourcePath: string }>) =>
      updateImportFieldMapping({ data: { id, edits } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const lockedReason: Partial<Record<TabId, string>> = {
    schema: stage === "upload" ? "Upload the file first." : "",
    field_mapping:
      stage === "upload" || stage === "detect_schema"
        ? "Run schema detection before editing the field mapping."
        : "",
    analysis: !isFmApproved
      ? "Approve field mapping before running analysis."
      : "",
    categories:
      STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]) <
      STAGE_ORDER.indexOf("mapping")
        ? "Run analysis first."
        : "",
    validation:
      STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]) <
      STAGE_ORDER.indexOf("validation")
        ? "Confirm category mappings first."
        : "",
    import:
      STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]) <
      STAGE_ORDER.indexOf("preview")
        ? "Compute preview first."
        : "",
  };
  const isLocked = (t: TabId) => !!lockedReason[t];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{String(batch.original_filename ?? "Import")}</h1>
          <div className="mt-1 text-xs text-muted-foreground">
            Batch ID: <span className="font-mono">{id}</span>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/$lang/admin/imports" params={{ lang }}>
            ← Back
          </Link>
        </Button>
      </div>

      <NextAction
        stage={stage}
        storageExists={storageExists}
        isFmApproved={isFmApproved}
        onDetect={() => detectMut.mutate()}
        onApproveMapping={() => approveMappingMut.mutate()}
        onAnalyze={() => analyzeMut.mutate()}
        onConfirmMapping={() => confirmMappingMut.mutate()}
        onPreview={() => previewMut.mutate()}
        onRun={() => runMut.mutate()}
        onTranslations={() => translationsMut.mutate()}
        onImagesDone={() => imagesDoneMut.mutate()}
        onPublish={() => publishMut.mutate()}
        detecting={detectMut.isPending}
        approving={approveMappingMut.isPending}
      />

      <StageProgress currentStage={stage} />

      <div className="flex flex-wrap gap-1 border-b">
        {TAB_IDS.map((t) => {
          const locked = isLocked(t);
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-3 py-1.5 text-sm capitalize transition-colors ${
                currentTab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              } ${locked ? "opacity-60" : ""}`}
              title={locked ? lockedReason[t] : undefined}
            >
              {t.replace("_", " ")}
              {locked ? " 🔒" : ""}
            </button>
          );
        })}
      </div>

      {currentTab === "overview" && (
        <OverviewTab
          batch={batch}
          storageExists={storageExists}
          provenance={provenance}
          items={items}
          onAnalyze={() => analyzeMut.mutate()}
          onConfirmMapping={() => confirmMappingMut.mutate()}
          onPreview={() => previewMut.mutate()}
          onRun={() => runMut.mutate()}
          onAutoRun={() => {
            setAutoRun(true);
            runMut.mutate();
          }}
          autoRunning={autoRun}
          onTranslations={() => translationsMut.mutate()}
          onImagesDone={() => imagesDoneMut.mutate()}
          onPublish={() => publishMut.mutate()}
          onCancel={() => cancelMut.mutate()}
          isAnalyzing={analyzeMut.isPending}
          isPreviewing={previewMut.isPending}
          isRunning={runMut.isPending}
        />
      )}
      {currentTab === "schema" && (
        isLocked("schema") ? (
          <LockedPanel reason={lockedReason.schema!} />
        ) : (
          <SchemaTab
            schema={detectedSchema}
            onDetect={() => detectMut.mutate()}
            detecting={detectMut.isPending}
          />
        )
      )}
      {currentTab === "field_mapping" && (
        isLocked("field_mapping") ? (
          <LockedPanel reason={lockedReason.field_mapping!} />
        ) : (
          <FieldMappingTab
            mapping={fieldMapping}
            schema={detectedSchema}
            isApproved={isFmApproved}
            activeApproval={activeFmApproval}
            fieldMappingHash={fieldMappingHash}
            onEdit={(edits) => editMappingMut.mutate(edits)}
            onRestore={() => restoreMappingMut.mutate()}
            onApprove={() => approveMappingMut.mutate()}
            saving={editMappingMut.isPending}
            restoring={restoreMappingMut.isPending}
            approving={approveMappingMut.isPending}
          />
        )
      )}
      {currentTab === "analysis" && (
        isLocked("analysis") ? (
          <LockedPanel reason={lockedReason.analysis!} />
        ) : (
          <AnalysisTab batch={batch} items={items} />
        )
      )}
      {currentTab === "categories" && (
        isLocked("categories") ? (
          <LockedPanel reason={lockedReason.categories!} />
        ) : (
          <MappingTab lang={lang} batchId={id} mappings={mappings} items={items} />
        )
      )}
      {currentTab === "validation" && (
        isLocked("validation") ? (
          <LockedPanel reason={lockedReason.validation!} />
        ) : (
          <ValidationTab items={items} />
        )
      )}
      {currentTab === "import" && (
        isLocked("import") ? (
          <LockedPanel reason={lockedReason.import!} />
        ) : (
          <ImportTab
            items={items}
            onToggleField={(itemId, current, field, checked) => {
              const next = checked
                ? Array.from(new Set([...current, field]))
                : current.filter((f) => f !== field);
              setApprovalMut.mutate({ itemId, approvedFields: next });
            }}
          />
        )
      )}
      {currentTab === "translations" && <TranslationsTab provenance={provenance} />}
      {currentTab === "images" && <ImagesTab provenance={provenance} />}
      {currentTab === "logs" && <LogsTab batch={batch} />}
    </div>
  );
}

function NextAction(props: {
  stage: string;
  storageExists: boolean;
  isFmApproved: boolean;
  onDetect: () => void;
  onApproveMapping: () => void;
  onAnalyze: () => void;
  onConfirmMapping: () => void;
  onPreview: () => void;
  onRun: () => void;
  onTranslations: () => void;
  onImagesDone: () => void;
  onPublish: () => void;
  detecting: boolean;
  approving: boolean;
}) {
  const { stage, storageExists, isFmApproved } = props;
  let label = "";
  let description = "";
  let onClick: (() => void) | null = null;
  let disabled = false;
  if (stage === "detect_schema") {
    label = props.detecting ? "Detecting…" : "Detect schema";
    description = "Scan the uploaded JSON and build the field inventory.";
    onClick = props.onDetect;
    disabled = !storageExists || props.detecting;
  } else if (stage === "field_mapping") {
    label = props.approving ? "Approving…" : "Approve field mapping → analysis";
    description = "Lock in the source → target field mapping and unlock analysis.";
    onClick = props.onApproveMapping;
    disabled = props.approving;
  } else if (stage === "analyze") {
    label = "Run analysis";
    description = "Normalize every record and count valid / invalid rows.";
    onClick = props.onAnalyze;
    disabled = !isFmApproved;
  } else if (stage === "mapping") {
    label = "Confirm category mappings";
    description = "Approve how source categories map to catalog categories.";
    onClick = props.onConfirmMapping;
  } else if (stage === "validation" || stage === "preview") {
    label = "Compute import preview";
    description = "Diff every record against the database (inserts / updates / noops).";
    onClick = props.onPreview;
  } else if (stage === "execute") {
    label = "Run next execute chunk";
    description = "Write the next batch of approved records to the database.";
    onClick = props.onRun;
  } else if (stage === "translations") {
    label = "Enqueue translations";
    description = "Queue TR/EN/AR translation jobs for imported businesses.";
    onClick = props.onTranslations;
  } else if (stage === "images") {
    label = "Advance images stage";
    description = "Image pipeline is Blocked; advance past this stage to publish.";
    onClick = props.onImagesDone;
  } else if (stage === "publish") {
    label = "Publish imported businesses";
    description = "Flip imported businesses from pending review to published.";
    onClick = props.onPublish;
  }
  if (!onClick) return null;
  return (
    <div className="rounded-xl border-2 border-primary/60 bg-primary/5 p-5 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1 text-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
          Next step · stage {stage}
        </div>
        <div className="mt-1 text-base font-semibold text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <Button size="lg" onClick={onClick} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

function LockedPanel({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      <div className="text-2xl">🔒</div>
      <div className="mt-2 font-medium text-foreground">This tab is locked</div>
      <div className="mt-1 text-xs">{reason}</div>
    </div>
  );
}

function StageProgress({ currentStage }: { currentStage: string }) {
  const currentIdx = STAGE_ORDER.indexOf(currentStage as (typeof STAGE_ORDER)[number]);
  return (
    <div className="overflow-x-auto rounded-xl border bg-card p-4">
      <div className="flex min-w-[720px] items-center gap-1">
        {STAGE_ORDER.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s} className="flex flex-1 items-center gap-1">
              <div
                className={`flex h-7 min-w-7 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-xs capitalize ${
                    active ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {s}
                </div>
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <div className={`h-px flex-1 ${i < currentIdx ? "bg-emerald-500" : "bg-border"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverviewTab(props: {
  batch: Record<string, unknown>;
  storageExists: boolean;
  provenance: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  onAnalyze: () => void;
  onConfirmMapping: () => void;
  onPreview: () => void;
  onRun: () => void;
  onAutoRun: () => void;
  autoRunning: boolean;
  onTranslations: () => void;
  onImagesDone: () => void;
  onPublish: () => void;
  onCancel: () => void;
  isAnalyzing: boolean;
  isPreviewing: boolean;
  isRunning: boolean;
}) {
  const { batch, storageExists, provenance } = props;
  const stage = String(batch.stage ?? "upload");
  const status = String(batch.status ?? "");
  const total = Number(batch.total_items ?? 0);
  const inserted = Number(batch.inserted_items ?? 0);
  const updated = Number(batch.updated_items ?? 0);
  const skipped = Number(batch.skipped_items ?? 0);
  const failed = Number(batch.failed_items ?? 0);
  const processed = Number(batch.processed_items ?? 0);
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const previewHash = String(batch.preview_hash ?? "");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card label="Stage">{stage}</Card>
        <Card label="Status">{status}</Card>
        <Card label="Storage">{storageExists ? "exists" : "MISSING"}</Card>
      </div>
      {batch.error_message ? (
        <ErrorPanel title="Last error" message={String(batch.error_message)} />
      ) : null}
      <div className="grid gap-3 md:grid-cols-6">
        <Card label="Total">{total}</Card>
        <Card label="Inserted" tone="success">{inserted}</Card>
        <Card label="Updated" tone="info">{updated}</Card>
        <Card label="Skipped" tone="warning">{skipped}</Card>
        <Card label="Failed" tone="danger">{failed}</Card>
        <Card label="Provenance rows">{provenance.length}</Card>
      </div>
      {total > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Execute progress</span>
            <span>{processed}/{total} · {pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${failed > 0 ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-4">
        {(stage === "analyze" || status === "failed" || status === "uploaded") && (
          <Button onClick={props.onAnalyze} disabled={props.isAnalyzing || !storageExists}>
            {props.isAnalyzing ? "Analyzing…" : "Analyze"}
          </Button>
        )}
        {stage === "mapping" && (
          <Button onClick={props.onConfirmMapping}>Confirm mappings → validation</Button>
        )}
        {(stage === "validation" || stage === "preview") && (
          <Button onClick={props.onPreview} disabled={props.isPreviewing}>
            {props.isPreviewing ? "Computing preview…" : previewHash ? "Re-compute preview" : "Compute preview"}
          </Button>
        )}
        {stage === "preview" && previewHash && (
          <>
            <Button onClick={props.onRun} disabled={props.isRunning}>
              {props.isRunning ? "Running chunk…" : "Run next chunk (50)"}
            </Button>
            <Button variant="outline" onClick={props.onAutoRun} disabled={props.isRunning || props.autoRunning}>
              {props.autoRunning ? "Auto-running…" : "Auto-run all"}
            </Button>
          </>
        )}
        {stage === "execute" && (
          <>
            <Button onClick={props.onRun} disabled={props.isRunning}>
              {props.isRunning ? "Running chunk…" : "Run next chunk (50)"}
            </Button>
            <Button variant="outline" onClick={props.onAutoRun} disabled={props.isRunning || props.autoRunning}>
              {props.autoRunning ? "Auto-running…" : "Auto-run all"}
            </Button>
          </>
        )}
        {stage === "translations" && (
          <Button onClick={props.onTranslations}>Enqueue translations → images</Button>
        )}
        {stage === "images" && (
          <Button onClick={props.onImagesDone}>Mark images stage done → publish</Button>
        )}
        {stage === "publish" && (
          <Button onClick={props.onPublish}>Publish all imported businesses</Button>
        )}
        {["uploaded", "analyzing", "ready", "importing"].includes(status) && (
          <Button variant="destructive" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {previewHash && (
        <div className="rounded-xl border bg-card p-3 text-xs">
          <span className="text-muted-foreground">preview_hash:</span>{" "}
          <span className="font-mono break-all">{previewHash.slice(0, 32)}…</span>
        </div>
      )}
    </div>
  );
}

function AnalysisTab({
  batch,
  items,
}: {
  batch: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}) {
  const counts = items.reduce<Record<string, number>>((acc, it) => {
    const k = String(it.intent ?? "unknown");
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-5">
        <Card label="Total">{Number(batch.total_items ?? 0)}</Card>
        <Card label="Valid">{Number(batch.valid_items ?? 0)}</Card>
        <Card label="Invalid" tone="danger">{Number(batch.invalid_items ?? 0)}</Card>
        <Card label="File hash">
          <span className="font-mono text-xs break-all">
            {String(batch.file_hash ?? "—").slice(0, 20)}…
          </span>
        </Card>
        <Card label="Format">{String((batch.metadata as Record<string, unknown>)?.format ?? "—")}</Card>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Intent breakdown</div>
        <div className="grid gap-2 text-sm md:grid-cols-5">
          {Object.entries(counts).map(([k, v]) => (
            <div key={k} className="rounded-md border px-2 py-1">
              <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
              <div className="font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MappingTab({
  lang,
  batchId,
  mappings,
  items,
}: {
  lang: string;
  batchId: string;
  mappings: Array<{ source_category: string; category_id: string | null; mapping_status: string }>;
  items: Array<Record<string, unknown>>;
}) {
  const discovered = useMemo(() => {
    const seen = new Set<string>();
    items.forEach((it) => {
      const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
      const n = rp.normalized as { categoriesSource?: string[]; primaryCategorySource?: string } | null;
      if (n) {
        (n.categoriesSource ?? []).forEach((c) => seen.add(c));
        if (n.primaryCategorySource) seen.add(n.primaryCategorySource);
      }
    });
    return Array.from(seen).sort();
  }, [items]);
  const byLabel = new Map(mappings.map((m) => [m.source_category, m]));
  const pending = discovered.filter((l) => {
    const status = byLabel.get(l)?.mapping_status ?? "pending";
    return status !== "approved" && status !== "ignored";
  });
  const returnTo = `/${lang}/admin/imports/${batchId}?tab=categories`;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">Discovered categories ({discovered.length})</div>
          <Button asChild size="sm" variant="outline">
            <Link to="/$lang/admin/category-mappings" params={{ lang }} search={{ returnTo }}>
              Open mappings admin
            </Link>
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Approve each label with a real category, or ignore labels you do not want to import.
          The workflow cannot continue while any label remains <em>pending</em>.
        </p>
        {pending.length > 0 && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            {pending.length} of {discovered.length} labels still pending. Open Category mappings,
            resolve them, then click Confirm category mappings again.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Source label</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Mapped category</th>
              </tr>
            </thead>
            <tbody>
              {discovered.map((l) => {
                const m = byLabel.get(l);
                const st = m?.mapping_status ?? "pending";
                return (
                  <tr key={l} className="border-t">
                    <td className="px-2 py-1 font-mono">{l}</td>
                    <td className="px-2 py-1">
                      <span
                        className={
                          st === "approved"
                            ? "rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700"
                            : st === "ignored"
                              ? "rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                            : "rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"
                        }
                      >
                        {st}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{m?.category_id ?? "—"}</td>
                  </tr>
                );
              })}
              {discovered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-2 py-4 text-center text-muted-foreground">
                    No categories discovered
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ValidationTab({ items }: { items: Array<Record<string, unknown>> }) {
  const invalid = items.filter((it) => String(it.status) === "invalid");
  const withWarnings = items.filter((it) => {
    const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
    return Array.isArray(rp.warnings) && (rp.warnings as unknown[]).length > 0;
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card label="Total items">{items.length}</Card>
        <Card label="Invalid" tone="danger">{invalid.length}</Card>
        <Card label="With warnings" tone="warning">{withWarnings.length}</Card>
      </div>
      <ItemTable
        items={items}
        columns={[
          "index",
          "place_id",
          "status",
          "intent",
          "errors",
          "warnings",
        ]}
      />
    </div>
  );
}

function ImportTab({
  items,
  onToggleField,
}: {
  items: Array<Record<string, unknown>>;
  onToggleField: (itemId: string, current: string[], field: string, checked: boolean) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const inserts = items.filter((it) => it.intent === "insert" && it.status !== "invalid");
  const updates = items.filter((it) => it.intent === "update");
  const noops = items.filter((it) => it.intent === "noop");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <Card label="Inserts" tone="success">{inserts.length}</Card>
        <Card label="Updates (diff)" tone="info">{updates.length}</Card>
        <Card label="Noops">{noops.length}</Card>
        <Card label="Total pending">
          {items.filter((i) => i.status === "pending").length}
        </Card>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Update proposals (three-state diff)</div>
        <p className="mb-3 text-xs text-muted-foreground">
          For each existing business, review current vs proposed values. Toggle fields
          you want the importer to overwrite. Fields curated by <em>admin</em> or{" "}
          <em>owner</em> are blocked from imports.
        </p>
        <div className="space-y-2">
          {updates.map((it) => {
            const id = String(it.id);
            const diff = (it.proposed_diff as { fields: Array<Record<string, unknown>>; changedCount: number; blockedCount: number } | null) ?? null;
            const approved = (it.approved_fields as string[]) ?? [];
            const open = openId === id;
            return (
              <div key={id} className="rounded-lg border">
                <button
                  onClick={() => setOpenId(open ? null : id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs">{String(it.place_id)}</div>
                    <div className="text-xs text-muted-foreground">
                      {diff?.changedCount ?? 0} changed · {diff?.blockedCount ?? 0} blocked · {approved.length} approved
                    </div>
                  </div>
                  <span className="text-xs">{open ? "▲" : "▼"}</span>
                </button>
                {open && diff && (
                  <div className="border-t p-3">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="px-1 py-1"></th>
                          <th className="px-1 py-1">Field</th>
                          <th className="px-1 py-1">Current</th>
                          <th className="px-1 py-1">Proposed</th>
                          <th className="px-1 py-1">Source</th>
                          <th className="px-1 py-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(diff.fields ?? []).map((f, i) => {
                          const field = String(f.field);
                          const st = String(f.status);
                          const isChanged = st === "changed";
                          const isChecked = approved.includes(field);
                          return (
                            <tr key={i} className="border-t align-top">
                              <td className="px-1 py-1">
                                {isChanged ? (
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) =>
                                      onToggleField(id, approved, field, e.currentTarget.checked)
                                    }
                                  />
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-1 py-1 font-mono">{field}</td>
                              <td className="px-1 py-1 text-muted-foreground max-w-[200px] truncate">
                                {formatVal(f.current)}
                              </td>
                              <td className="px-1 py-1 max-w-[200px] truncate">
                                {formatVal(f.proposed)}
                              </td>
                              <td className="px-1 py-1 text-muted-foreground">{String(f.source)}</td>
                              <td className="px-1 py-1">
                                <StatusChip status={st} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {updates.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No update proposals in this batch.
            </div>
          )}
        </div>
      </div>

      {inserts.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-sm font-medium">Inserts (new place_ids)</div>
          <p className="mb-2 text-xs text-muted-foreground">
            New businesses will be inserted with all {IMPORTABLE_FIELDS.length} importable fields
            and land as <code>pending_review</code>. They become public only after the Publish stage.
          </p>
          <ItemTable items={inserts} columns={["index", "place_id", "status", "action"]} />
        </div>
      )}
    </div>
  );
}

function TranslationsTab({ provenance }: { provenance: Array<Record<string, unknown>> }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-sm">
      <div className="mb-1 font-medium">Translations stage</div>
      <p className="text-xs text-muted-foreground">
        Enqueued Lovable AI translation jobs for {provenance.length} touched businesses.
        Check <Link to="." className="underline">Translations admin</Link> for job progress.
      </p>
    </div>
  );
}

function ImagesTab({ provenance }: { provenance: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
        <div className="font-medium">R2 image pipeline: Blocked by configuration</div>
        <p className="mt-1 text-xs">
          Image records are created and jobs are enqueued during execute, but the R2 worker
          requires production credentials to actually fetch, normalize, and upload. Marking
          this stage done advances the workflow to Publish; images will hydrate when the
          worker is enabled.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-4 text-sm">
        <div className="mb-1 font-medium">Touched businesses: {provenance.length}</div>
        <p className="text-xs text-muted-foreground">
          See <Link to="." className="underline">Images admin</Link> for record vs job counts.
        </p>
      </div>
    </div>
  );
}

function LogsTab({ batch }: { batch: Record<string, unknown> }) {
  const history = (Array.isArray(batch.stage_history) ? (batch.stage_history as Array<Record<string, unknown>>) : []).slice().reverse();
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-medium">Stage history ({history.length} entries)</div>
      <ol className="space-y-1 text-xs">
        {history.map((h, i) => (
          <li key={i} className="flex gap-3 border-b py-1 last:border-b-0">
            <span className="text-muted-foreground">{String(h.at)}</span>
            <span>
              <span className="text-muted-foreground">{String(h.from ?? "—")}</span> →{" "}
              <strong>{String(h.to)}</strong>
            </span>
          </li>
        ))}
        {history.length === 0 && <li className="text-muted-foreground">No entries yet</li>}
      </ol>
    </div>
  );
}

// ---------- Small primitives ----------

function Card({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "success" | "info" | "warning" | "danger";
}) {
  const cls =
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
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${cls}`}>{children}</div>
    </div>
  );
}

function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <div className="font-medium text-destructive">{title}</div>
      <div className="mt-1 whitespace-pre-wrap break-all text-xs">{message}</div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "changed"
      ? "bg-blue-100 text-blue-700"
      : status === "blocked_by_curation"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone}`}>{status}</span>;
}

function ItemTable({
  items,
  columns,
}: {
  items: Array<Record<string, unknown>>;
  columns: Array<"index" | "place_id" | "status" | "intent" | "action" | "errors" | "warnings">;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left uppercase text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 300).map((it) => {
            const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
            const warnings = Array.isArray(rp.warnings) ? (rp.warnings as string[]) : [];
            const errors = Array.isArray(rp.errors) ? (rp.errors as string[]) : [];
            return (
              <tr key={String(it.id)} className="border-t align-top">
                {columns.map((c) => (
                  <td key={c} className="px-2 py-1">
                    {c === "index" && String(it.item_index)}
                    {c === "place_id" && (
                      <span className="font-mono text-[11px]">{String(it.place_id ?? "—")}</span>
                    )}
                    {c === "status" && String(it.status)}
                    {c === "intent" && String(it.intent ?? "—")}
                    {c === "action" && String(it.action ?? "—")}
                    {c === "errors" && (errors.length ? errors.join(", ") : "—")}
                    {c === "warnings" && (
                      <span className="text-muted-foreground">
                        {warnings.length ? warnings.join(", ") : "—"}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-2 py-4 text-center text-muted-foreground">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {items.length > 300 && (
        <div className="p-2 text-center text-xs text-muted-foreground">
          Showing first 300 of {items.length}
        </div>
      )}
    </div>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v).slice(0, 60);
  } catch {
    return "?";
  }
}

// ---------- Schema tab ----------
import type { DetectedSchema, MappingRow as MR } from "@/lib/import/schema-detector";

function SchemaTab({
  schema,
  onDetect,
  detecting,
}: {
  schema: DetectedSchema | null;
  onDetect: () => void;
  detecting: boolean;
}) {
  if (!schema) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm">
        <div className="mb-2 font-medium">No schema detected yet</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Walk the uploaded JSON and build a complete field inventory.
        </p>
        <Button onClick={onDetect} disabled={detecting}>
          {detecting ? "Detecting…" : "Detect schema"}
        </Button>
      </div>
    );
  }
  const rows = schema.fields;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card label="Items scanned">{schema.totalItems}</Card>
        <Card label="Fields detected">{rows.length}</Card>
        <Card label="Generated at">
          <span className="text-xs">{new Date(schema.generatedAt).toLocaleString()}</span>
        </Card>
      </div>
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1">Path</th>
              <th className="px-2 py-1">Type</th>
              <th className="px-2 py-1">Occ.</th>
              <th className="px-2 py-1">Null</th>
              <th className="px-2 py-1">Missing</th>
              <th className="px-2 py-1">Null+Miss %</th>
              <th className="px-2 py-1">Confidence</th>
              <th className="px-2 py-1">Samples</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.sourcePath} className="border-t align-top">
                <td className="px-2 py-1 font-mono">{f.sourcePath}</td>
                <td className="px-2 py-1">{f.detectedType}</td>
                <td className="px-2 py-1">{f.occurrenceCount}/{f.parentCount}</td>
                <td className="px-2 py-1">{f.nullCount}</td>
                <td className="px-2 py-1">{f.missingCount}</td>
                <td className="px-2 py-1">{f.nullMissingPct}%</td>
                <td className="px-2 py-1">{f.confidence}</td>
                <td className="px-2 py-1 max-w-[280px] truncate text-muted-foreground">
                  {f.sampleValues.map((s) => formatVal(s)).join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Field mapping tab ----------

const TARGET_TABLES = [
  "",
  "businesses",
  "business_opening_hours",
  "business_category_links",
  "business_images",
  "reviews",
];

function FieldMappingTab({
  mapping,
  schema,
  isApproved,
  activeApproval,
  fieldMappingHash,
  onEdit,
  onRestore,
  onApprove,
  saving,
  restoring,
  approving,
}: {
  mapping: MR[];
  schema: DetectedSchema | null;
  isApproved: boolean;
  activeApproval: Record<string, unknown> | undefined;
  fieldMappingHash: string;
  onEdit: (edits: Array<Partial<MR> & { sourcePath: string }>) => void;
  onRestore: () => void;
  onApprove: () => void;
  saving: boolean;
  restoring: boolean;
  approving: boolean;
}) {
  const samplesByPath = new Map(
    (schema?.fields ?? []).map((f) => [f.sourcePath, f.sampleValues]),
  );
  const [openSamples, setOpenSamples] = useState<string | null>(null);

  if (mapping.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        No field mapping — detect schema first.
      </div>
    );
  }
  const required = mapping.filter((r) => r.required);
  const unresolvedRequired = required.filter(
    (r) => r.status !== "mapped" || !r.targetTable || !r.targetColumn,
  );
  const canApprove = unresolvedRequired.length === 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <Card label="Mapping rows">{mapping.length}</Card>
        <Card label="Required">{required.length}</Card>
        <Card label="Unresolved required" tone={unresolvedRequired.length ? "danger" : undefined}>
          {unresolvedRequired.length}
        </Card>
        <Card label="Approval status" tone={isApproved ? "success" : "warning"}>
          {isApproved ? "approved" : "pending"}
        </Card>
      </div>
      <div className="rounded-xl border bg-card p-3 text-xs">
        <div>
          <span className="text-muted-foreground">field_mapping_hash:</span>{" "}
          <span className="font-mono break-all">{fieldMappingHash.slice(0, 32)}…</span>
        </div>
        {activeApproval && (
          <div className="mt-1">
            <span className="text-muted-foreground">approved artifact_hash:</span>{" "}
            <span className="font-mono break-all">
              {String(activeApproval.artifact_hash).slice(0, 32)}…
            </span>
            {activeApproval.artifact_hash !== fieldMappingHash && (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                stale
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onApprove} disabled={!canApprove || approving}>
          {approving ? "Approving…" : isApproved ? "Re-approve mapping" : "Approve mapping"}
        </Button>
        <Button variant="outline" onClick={onRestore} disabled={restoring}>
          {restoring ? "Restoring…" : "Restore suggested"}
        </Button>
      </div>
      {!canApprove && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          Required fields must be resolved before approval:{" "}
          {unresolvedRequired.map((r) => r.sourcePath).join(", ")}
        </div>
      )}
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1">Source path</th>
              <th className="px-2 py-1">Target table</th>
              <th className="px-2 py-1">Target column</th>
              <th className="px-2 py-1">Transform</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Required</th>
              <th className="px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mapping.map((r) => {
              const samples = samplesByPath.get(r.sourcePath) ?? [];
              return (
                <>
                  <tr key={r.sourcePath} className="border-t align-top">
                    <td className="px-2 py-1 font-mono">{r.sourcePath}</td>
                    <td className="px-2 py-1">
                      <select
                        className="rounded border bg-background px-1 py-0.5 text-xs disabled:opacity-50"
                        value={r.targetTable ?? ""}
                        disabled={saving}
                        onChange={(e) =>
                          onEdit([
                            {
                              sourcePath: r.sourcePath,
                              targetTable: e.target.value || null,
                              status: e.target.value ? "mapped" : "ignored",
                            },
                          ])
                        }
                      >
                        {TARGET_TABLES.map((t) => (
                          <option key={t} value={t}>{t || "(none)"}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="w-32 rounded border bg-background px-1 py-0.5 text-xs font-mono disabled:opacity-50"
                        value={r.targetColumn ?? ""}
                        disabled={saving}
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v === (r.targetColumn ?? null)) return;
                          onEdit([{ sourcePath: r.sourcePath, targetColumn: v }]);
                        }}
                        defaultValue={r.targetColumn ?? ""}
                        placeholder="column"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="w-28 rounded border bg-background px-1 py-0.5 text-xs font-mono disabled:opacity-50"
                        defaultValue={r.transform ?? ""}
                        disabled={saving}
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v === (r.transform ?? null)) return;
                          onEdit([{ sourcePath: r.sourcePath, transform: v }]);
                        }}
                        placeholder="identity"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <MappingStatusChip status={r.status} />
                      {r.reason && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{r.reason}</div>
                      )}
                    </td>
                    <td className="px-2 py-1">{r.required ? "yes" : "no"}</td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1">
                        {!r.required && r.status !== "ignored" && (
                          <button
                            className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                            disabled={saving}
                            onClick={() =>
                              onEdit([
                                {
                                  sourcePath: r.sourcePath,
                                  status: "ignored",
                                  targetTable: null,
                                  targetColumn: null,
                                },
                              ])
                            }
                          >
                            ignore
                          </button>
                        )}
                        {r.required && (
                          <span
                            className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800"
                            title="Required — cannot be ignored"
                          >
                            required
                          </span>
                        )}
                        <button
                          className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                          onClick={() =>
                            setOpenSamples(openSamples === r.sourcePath ? null : r.sourcePath)
                          }
                        >
                          samples
                        </button>
                      </div>
                    </td>
                  </tr>
                  {openSamples === r.sourcePath && (
                    <tr key={r.sourcePath + "-s"} className="border-t bg-muted/30">
                      <td colSpan={7} className="px-2 py-2 text-[11px]">
                        <div className="font-medium">Sample values ({samples.length})</div>
                        <ul className="mt-1 list-disc pl-4">
                          {samples.map((s, i) => (
                            <li key={i} className="font-mono">
                              {formatVal(s)}
                            </li>
                          ))}
                          {samples.length === 0 && <li className="text-muted-foreground">—</li>}
                        </ul>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MappingStatusChip({ status }: { status: MR["status"] }) {
  const tones: Record<MR["status"], string> = {
    mapped: "bg-emerald-100 text-emerald-700",
    ignored: "bg-muted text-muted-foreground",
    unsupported: "bg-amber-100 text-amber-800",
    required_missing: "bg-destructive/10 text-destructive",
    store: "bg-blue-100 text-blue-700",
  };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${tones[status]}`}>{status}</span>;
}

