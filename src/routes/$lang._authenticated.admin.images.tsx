import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getImagePipelineStatus, listImageJobs, retryImageJob, cancelImageJob } from "@/lib/images/queue.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type StatusFilter = "pending" | "processing" | "retry" | "uploaded" | "failed" | "cancelled";

const statusQuery = queryOptions({
  queryKey: ["admin", "images", "status"],
  queryFn: () => getImagePipelineStatus(),
});

function jobsQuery(status?: StatusFilter) {
  return queryOptions({
    queryKey: ["admin", "images", "jobs", status ?? "all"],
    queryFn: () => listImageJobs({ data: { status, limit: 100 } }),
  });
}

export const Route = createFileRoute("/$lang/_authenticated/admin/images")({
  ssr: false,
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(statusQuery),
    context.queryClient.ensureQueryData(jobsQuery()),
  ]),
  component: AdminImagesPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load image pipeline: {(error as Error).message}
        <button className="ml-2 underline" onClick={() => { reset(); router.invalidate(); }}>Retry</button>
      </div>
    );
  },
});

function AdminImagesPage() {
  const [filter, setFilter] = useState<StatusFilter | undefined>(undefined);
  const { data: status } = useSuspenseQuery(statusQuery);
  const { data: jobs } = useSuspenseQuery(jobsQuery(filter));
  const qc = useQueryClient();
  const retryFn = useServerFn(retryImageJob);
  const cancelFn = useServerFn(cancelImageJob);

  const retry = useMutation({
    mutationFn: (id: string) => retryFn({ data: { imageId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "images"] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { imageId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "images"] }),
  });

  const statuses: Array<StatusFilter | undefined> = [undefined, "pending", "processing", "retry", "uploaded", "failed", "cancelled"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Images pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Fetches remote source images, normalizes them, and stores them in R2.
        </p>
      </div>

      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">Cloudflare R2 status</div>
        {status.r2.configured ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Configured</Badge>
            <span className="text-sm text-muted-foreground">Access mode: {status.r2.accessMode}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <Badge variant="destructive">Not configured</Badge>
            <p className="text-sm text-muted-foreground">
              The worker is a safe no-op until R2 credentials are provisioned. Missing secrets:
            </p>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {status.r2.missing.map((m) => <li key={m}><code>{m}</code></li>)}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["total", "pending", "processing", "uploaded", "failed"] as const).map((k) => (
          <Card key={k} className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{status.counts[k]}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Button key={s ?? "all"} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
            {s ?? "all"}
          </Button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Image</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempt</th>
                <th className="px-3 py-2">Last error</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{j.business_image_id.slice(0, 8)}</td>
                  <td className="px-3 py-2"><Badge variant="secondary">{j.status}</Badge></td>
                  <td className="px-3 py-2 tabular-nums">{j.attempt} / {j.max_attempts}</td>
                  <td className="px-3 py-2 max-w-xs truncate text-xs text-muted-foreground">
                    {j.last_error_code ? `${j.last_error_code}: ${j.last_error ?? ""}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(j.updated_at as string).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <Button size="sm" variant="outline" onClick={() => retry.mutate(j.business_image_id)}>
                          Retry
                        </Button>
                      )}
                      {(j.status === "pending" || j.status === "processing" || j.status === "retry") && (
                        <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.business_image_id)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">No jobs.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
