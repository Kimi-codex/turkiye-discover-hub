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
    onSuccess: () => {
      toast.success("Analyzed");
      qc.invalidateQueries({ queryKey: ["admin", "import", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMut = useMutation({
    mutationFn: () => runImportChunk({ data: { id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin", "import", id] });
      if (autoRun && !res.done) {
        setTimeout(() => runMut.mutate(), 200);
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

  const counts = items.reduce<Record<string, number>>((acc, it) => {
    const s = String(it.status);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{String(batch.file_name ?? "Import")}</h1>
          <div className="text-xs text-muted-foreground">
            Status: <strong>{String(batch.status)}</strong> · Format:{" "}
            {String(batch.source_format ?? "—")}
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/$lang/_authenticated/admin/imports" params={{ lang }}>
            Back
          </Link>
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Total" value={String(batch.total_items ?? 0)} />
        <Metric label="Valid" value={String(batch.valid_items ?? 0)} />
        <Metric label="Invalid" value={String(batch.invalid_items ?? 0)} />
        <Metric label="Pending in queue" value={String(counts.pending ?? 0)} />
      </div>
      <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-4">
        {batch.status === "uploading" || batch.status === "failed" ? (
          <Button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending}>
            {analyzeMut.isPending ? "Analyzing…" : "Analyze"}
          </Button>
        ) : null}
        {batch.status === "analyzed" || batch.status === "running" || batch.status === "paused" ? (
          <>
            <Button
              onClick={() => runMut.mutate()}
              disabled={runMut.isPending}
            >
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
        ) : null}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Recent items</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">place_id</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Action</th>
                <th className="px-2 py-1">Errors / warnings</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 100).map((it) => (
                <tr key={String(it.id)} className="border-t">
                  <td className="px-2 py-1">{String(it.item_index)}</td>
                  <td className="px-2 py-1 font-mono">{String(it.place_id ?? "—")}</td>
                  <td className="px-2 py-1">{String(it.status)}</td>
                  <td className="px-2 py-1">{String(it.action ?? "—")}</td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {[
                      ...(Array.isArray(it.errors) ? (it.errors as string[]) : []),
                      ...(Array.isArray(it.warnings) ? (it.warnings as string[]) : []),
                    ].join(", ")}
                    {it.error_message ? ` · ${String(it.error_message)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
