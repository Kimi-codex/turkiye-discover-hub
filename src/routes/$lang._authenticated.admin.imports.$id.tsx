import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeImportBatch,
  getImportBatch,
  runImportChunk,
  cancelImportBatch,
} from "@/lib/admin/imports.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/imports/$id")({
  ssr: false,
  component: ImportDetailPage,
});

function ImportDetailPage() {
  const { lang, id } = Route.useParams();
  const qc = useQueryClient();
  const [autoRun, setAutoRun] = useState(false);
  const q = useQuery({
    queryKey: ["admin", "import", id],
    queryFn: () => getImportBatch({ data: { id } }),
    refetchInterval: 2000,
  });

  const analyzeMut = useMutation({
    mutationFn: () => analyzeImportBatch({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Analyzed: ${r.valid} valid / ${r.invalid} invalid (${r.format})`);
      qc.invalidateQueries({ queryKey: ["admin", "import", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMut = useMutation({
    mutationFn: () => runImportChunk({ data: { id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin", "import", id] });
      if (autoRun && !res.done) {
        setTimeout(() => runMut.mutate(), 250);
      } else if (res.done) {
        setAutoRun(false);
        toast.success("Import complete");
      }
    },
    onError: (e: Error) => {
      setAutoRun(false);
      toast.error(e.message);
    },
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelImportBatch({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "import", id] }),
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (q.error) return <div className="p-6 text-sm text-destructive">{(q.error as Error).message}</div>;
  const batch = q.data!.batch as Record<string, unknown>;
  const items = q.data!.items as Array<Record<string, unknown>>;
  const storageExists = q.data!.storageExists as boolean;
  const status = String(batch.status);

  const counts = items.reduce<Record<string, number>>((acc, it) => {
    const s = String(it.status);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{String(batch.original_filename ?? "Import")}</h1>
          <div className="text-xs text-muted-foreground">
            Status: <strong>{status}</strong> · Detected format:{" "}
            {String(batch.source ?? "—")}
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/$lang/_authenticated/admin/imports" params={{ lang }}>
            Back
          </Link>
        </Button>
      </div>

      {/* File / Storage */}
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Bucket" value={String(batch.storage_bucket ?? "—")} />
        <Metric label="Object" value={String(batch.storage_object_path ?? "—")} mono small />
        <Metric label="Storage exists" value={storageExists ? "yes" : "NO"} />
      </div>

      {batch.error_message ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">Last error</div>
          <div className="mt-1 text-xs">{String(batch.error_message)}</div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-6">
        <Metric label="Total" value={String(batch.total_items ?? 0)} />
        <Metric label="Valid" value={String(batch.valid_items ?? 0)} />
        <Metric label="Invalid" value={String(batch.invalid_items ?? 0)} />
        <Metric label="Inserted" value={String(batch.inserted_items ?? 0)} />
        <Metric label="Updated" value={String(batch.updated_items ?? 0)} />
        <Metric label="Skipped" value={String(batch.skipped_items ?? 0)} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-4">
        {(status === "uploaded" || status === "failed") && (
          <Button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending || !storageExists}>
            {analyzeMut.isPending ? "Analyzing…" : "Analyze"}
          </Button>
        )}
        {(status === "ready" || status === "importing") && (
          <>
            <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}>
              {runMut.isPending ? "Running chunk…" : "Run next chunk (50)"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAutoRun(true);
                runMut.mutate();
              }}
              disabled={runMut.isPending || autoRun}
            >
              {autoRun ? "Auto-running…" : "Auto-run all"}
            </Button>
            <Button variant="destructive" onClick={() => cancelMut.mutate()}>
              Cancel
            </Button>
          </>
        )}
        {["completed", "partially_completed"].includes(status) && (
          <div className="text-xs text-muted-foreground">
            Item statuses: {Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" · ")}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-medium">
          Items ({items.length}
          {items.length >= 500 ? "+ (showing first 500)" : ""})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">place_id</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Action</th>
                <th className="px-2 py-1">Reason / warnings</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 200).map((it) => {
                const rp = (it.raw_payload as Record<string, unknown> | null) ?? {};
                const warnings = Array.isArray(rp.warnings) ? (rp.warnings as string[]) : [];
                const errors = Array.isArray(rp.errors) ? (rp.errors as string[]) : [];
                return (
                  <tr key={String(it.id)} className="border-t align-top">
                    <td className="px-2 py-1">{String(it.item_index)}</td>
                    <td className="px-2 py-1 font-mono text-[11px]">
                      {String(it.place_id ?? "—")}
                    </td>
                    <td className="px-2 py-1">{String(it.status)}</td>
                    <td className="px-2 py-1">{String(it.action ?? "—")}</td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {it.error_message ? (
                        <div className="text-destructive">{String(it.error_message)}</div>
                      ) : null}
                      {errors.length > 0 ? <div>errors: {errors.join(", ")}</div> : null}
                      {warnings.length > 0 ? <div>warnings: {warnings.join(", ")}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`${small ? "text-xs" : "text-2xl"} font-semibold ${mono ? "font-mono break-all" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
