import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getTranslationPipelineStatus,
  listTranslationJobs,
  runTranslationJobs,
  enqueueAllTranslations,
} from "@/lib/translations/translation.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const statusQuery = queryOptions({
  queryKey: ["admin", "translations", "status"],
  queryFn: () => getTranslationPipelineStatus(),
});
const jobsQuery = queryOptions({
  queryKey: ["admin", "translations", "jobs"],
  queryFn: () => listTranslationJobs(),
});

export const Route = createFileRoute("/$lang/_authenticated/admin/translations")({
  ssr: false,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(statusQuery),
      context.queryClient.ensureQueryData(jobsQuery),
    ]),
  component: AdminTranslationsPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load translations: {(error as Error).message}
        <button
          className="ml-2 underline"
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Retry
        </button>
      </div>
    );
  },
});

function AdminTranslationsPage() {
  const { data: status } = useSuspenseQuery(statusQuery);
  const { data: jobs } = useSuspenseQuery(jobsQuery);
  const qc = useQueryClient();
  const runFn = useServerFn(runTranslationJobs);
  const enqFn = useServerFn(enqueueAllTranslations);

  const run = useMutation({
    mutationFn: () => runFn({ data: { limit: 10 } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "translations"] }),
  });
  const enq = useMutation({
    mutationFn: () => enqFn({}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "translations"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Translations pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Automatic tr ⇄ en ⇄ ar translation for business <code>name</code> and{" "}
            <code>description</code>. Cached by source-text hash so re-runs are free.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => enq.mutate()} disabled={enq.isPending}>
            {enq.isPending ? "Enqueuing…" : "Enqueue missing"}
          </Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Running…" : "Run 10 jobs"}
          </Button>
        </div>
      </div>

      {!status.providerConfigured && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          <Badge variant="destructive">Provider blocked</Badge>{" "}
          <code>LOVABLE_API_KEY</code> is not configured. Jobs will fail until the key is set.
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Pending" value={status.jobs.pending} />
        <MetricCard label="Processing" value={status.jobs.processing} />
        <MetricCard label="Completed" value={status.jobs.completed} />
        <MetricCard label="Failed" value={status.jobs.failed} />
        <MetricCard label="Cancelled" value={status.jobs.cancelled} />
        <MetricCard label="Blocked" value={status.jobs.blocked} />
        <MetricCard label="Cached rows" value={status.totalTranslations} />
      </div>

      {run.data && (
        <Card className="p-3 text-xs">
          Last run: {run.data.length === 0 ? "no pending jobs" : `${run.data.length} processed`} —{" "}
          {run.data
            .map((r) => `${r.jobId.slice(0, 6)}:${r.status}`)
            .join(" · ")}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Src → Tgt</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Last error</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const row = j as {
                  id: string;
                  business_id: string;
                  target_language: string;
                  source_field: string;
                  source_language: string | null;
                  status: string;
                  attempts: number;
                  last_error: string | null;
                  model: string | null;
                  updated_at: string;
                };
                return (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{row.business_id.slice(0, 8)}</td>
                    <td className="px-3 py-2">{row.source_field}</td>
                    <td className="px-3 py-2 uppercase">
                      {row.source_language ?? "?"} → {row.target_language}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">{row.status}</Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.attempts}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{row.model ?? "—"}</td>
                    <td className="px-3 py-2 max-w-xs truncate text-xs text-destructive">
                      {row.last_error ?? ""}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(row.updated_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No translation jobs yet. Click "Enqueue missing" to seed the queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}
