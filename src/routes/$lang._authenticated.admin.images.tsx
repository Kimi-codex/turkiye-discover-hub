import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  deleteImageRecord,
  deleteImageRecords,
  getImagePipelineStatus,
  listImageJobs,
  listImageRecords,
  retryImageJob,
  cancelImageJob,
} from "@/lib/images/queue.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type JobStatus = "pending" | "processing" | "retry" | "uploaded" | "failed" | "cancelled";
type ImageRecord = Awaited<ReturnType<typeof listImageRecords>>[number];

const statusQuery = queryOptions({
  queryKey: ["admin", "images", "status"],
  queryFn: () => getImagePipelineStatus(),
});

function jobsQuery(status?: JobStatus) {
  return queryOptions({
    queryKey: ["admin", "images", "jobs", status ?? "all"],
    queryFn: () => listImageJobs({ data: { status, limit: 100 } }),
  });
}

function recordsQuery(hasSourceUrl?: "yes" | "no") {
  return queryOptions({
    queryKey: ["admin", "images", "records", hasSourceUrl ?? "all"],
    queryFn: () => listImageRecords({ data: { hasSourceUrl, limit: 200 } }),
  });
}

export const Route = createFileRoute("/$lang/_authenticated/admin/images")({
  ssr: false,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(statusQuery),
      context.queryClient.ensureQueryData(recordsQuery()),
      context.queryClient.ensureQueryData(jobsQuery()),
    ]),
  component: AdminImagesPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load image pipeline: {(error as Error).message}
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

function AdminImagesPage() {
  const [tab, setTab] = useState<"records" | "jobs">("records");
  const [jobFilter, setJobFilter] = useState<JobStatus | undefined>(undefined);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const { data: status } = useSuspenseQuery(statusQuery);
  const { data: records } = useSuspenseQuery(recordsQuery());
  const { data: jobs } = useSuspenseQuery(jobsQuery(jobFilter));
  const qc = useQueryClient();
  const retryFn = useServerFn(retryImageJob);
  const cancelFn = useServerFn(cancelImageJob);
  const deleteRecordFn = useServerFn(deleteImageRecord);
  const deleteRecordsFn = useServerFn(deleteImageRecords);

  const retry = useMutation({
    mutationFn: (id: string) => retryFn({ data: { imageId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "images"] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { imageId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "images"] }),
  });
  const deleteOne = useMutation({
    mutationFn: (id: string) => deleteRecordFn({ data: { imageId: id } }),
    onSuccess: async (r, id) => {
      setSelectedRecords((prev) => prev.filter((recordId) => recordId !== id));
      toast.success(`Deleted ${r.deleted} image record`);
      await qc.invalidateQueries({ queryKey: ["admin", "images"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMany = useMutation({
    mutationFn: (ids: string[]) => deleteRecordsFn({ data: { imageIds: ids } }),
    onSuccess: async (r) => {
      toast.success(`Deleted ${r.deleted} image records`);
      setSelectedRecords([]);
      await qc.invalidateQueries({ queryKey: ["admin", "images"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const r = status.records;
  const j = status.jobs;
  const allVisibleSelected = records.length > 0 && records.every((row: ImageRecord) => selectedRecords.includes(row.id));
  const toggleRecord = (id: string, checked: boolean) => {
    setSelectedRecords((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((recordId) => recordId !== id),
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Images pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Two data sources shown separately: source image records (rows in{" "}
          <code>business_images</code>) and processing jobs (rows in{" "}
          <code>image_processing_jobs</code>). Nothing is combined under a shared "Total" number.
        </p>
      </div>

      {/* R2 banner — always visible while unconfigured */}
      {!status.r2.configured && (
        <Card className="border-destructive/40 bg-destructive/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">R2: Blocked by configuration</Badge>
            <span className="text-sm">Worker disabled · Scheduler disabled</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            The image worker is a safe no-op until R2 credentials are provisioned. Records with{" "}
            <code>storage_status='external_only'</code> render directly from their{" "}
            <code>source_url</code> as a fallback.
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            {status.r2.missing.map((m) => (
              <li key={m}>
                <code>{m}</code>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {status.r2.configured && (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">R2 configured</Badge>
            <span className="text-sm text-muted-foreground">
              Access mode: {status.r2.accessMode}
            </span>
          </div>
        </Card>
      )}

      {/* Source image records */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Source image records
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Records" value={r.total} />
          <MetricCard label="Google source URLs" value={r.by_source_type.google_places} />
          <MetricCard label="Missing source URL" value={r.missing_source_url} />
          <MetricCard label="With R2 key" value={r.with_r2_key} />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          By storage status:{" "}
          {Object.entries(r.by_storage_status)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}
        </div>
      </div>

      {/* Processing jobs */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Processing jobs
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Queued jobs" value={j.queued} sub={`pending ${j.pending} · retry ${j.retry}`} />
          <MetricCard label="Processing" value={j.processing} />
          <MetricCard label="Uploaded to R2" value={j.uploaded} />
          <MetricCard label="Failed" value={j.failed} sub={`cancelled ${j.cancelled}`} />
        </div>
      </div>

      {/* View switch */}
      <div className="flex items-center gap-2 border-b">
        <TabButton active={tab === "records"} onClick={() => setTab("records")}>
          Records ({records.length})
        </TabButton>
        <TabButton active={tab === "jobs"} onClick={() => setTab("jobs")}>
          Jobs ({jobs.length})
        </TabButton>
      </div>

      {tab === "records" ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <div className="text-sm text-muted-foreground">
              {selectedRecords.length} selected · deleting a record also cancels its active image jobs.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedRecords(allVisibleSelected ? [] : records.map((row: ImageRecord) => row.id))}
                disabled={records.length === 0}
              >
                {allVisibleSelected ? "Clear selection" : "Select all visible"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMany.mutate(selectedRecords)}
                disabled={selectedRecords.length === 0 || deleteMany.isPending}
              >
                Delete selected
              </Button>
            </div>
          </div>
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all visible image records"
                      checked={allVisibleSelected}
                      onChange={(e) =>
                        setSelectedRecords(e.currentTarget.checked ? records.map((row: ImageRecord) => row.id) : [])
                      }
                    />
                  </th>
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">src_url</th>
                  <th className="px-3 py-2">r2_key</th>
                  <th className="px-3 py-2">storage_status</th>
                  <th className="px-3 py-2">source_type</th>
                  <th className="px-3 py-2">import_batch_id</th>
                  <th className="px-3 py-2">created_at</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row: Awaited<ReturnType<typeof listImageRecords>>[number]) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select image record ${row.id}`}
                        checked={selectedRecords.includes(row.id)}
                        onChange={(e) => toggleRecord(row.id, e.currentTarget.checked)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.business_name}</div>
                      <div className="text-xs text-muted-foreground">
                        source: {row.business_source}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <YesNo v={!!row.source_url} />
                    </td>
                    <td className="px-3 py-2">
                      <YesNo v={!!row.r2_key} />
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">{row.storage_status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.source_type}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">
                      {row.import_batch_id ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteOne.mutate(row.id)}
                        disabled={deleteOne.isPending}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No image records.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(
              [undefined, "pending", "processing", "retry", "uploaded", "failed", "cancelled"] as Array<
                JobStatus | undefined
              >
            ).map((s) => (
              <Button
                key={s ?? "all"}
                size="sm"
                variant={jobFilter === s ? "default" : "outline"}
                onClick={() => setJobFilter(s)}
              >
                {s ?? "all"}
              </Button>
            ))}
          </div>
          <Card className="overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2">Image id</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Attempt</th>
                    <th className="px-3 py-2">Last error</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((jb) => (
                    <tr key={jb.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">
                        {String(jb.business_image_id).slice(0, 8)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{jb.status}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {jb.attempt} / {jb.max_attempts}
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate text-xs text-muted-foreground">
                        {jb.last_error_code
                          ? `${jb.last_error_code}: ${jb.last_error ?? ""}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(jb.updated_at as string).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {(jb.status === "failed" || jb.status === "cancelled") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retry.mutate(jb.business_image_id)}
                            >
                              Retry
                            </Button>
                          )}
                          {(jb.status === "pending" ||
                            jb.status === "processing" ||
                            jb.status === "retry") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => cancel.mutate(jb.business_image_id)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        No jobs.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

function YesNo({ v }: { v: boolean }) {
  return (
    <span
      className={
        v
          ? "inline-flex rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
          : "inline-flex rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      }
    >
      {v ? "yes" : "no"}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm ${
        active ? "border-b-2 border-primary font-medium" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
