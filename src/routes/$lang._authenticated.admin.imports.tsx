import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createImportBatch,
  listImportBatches,
  cancelImportBatch,
  markImportBatchUploaded,
  markImportBatchFailed,
} from "@/lib/admin/imports.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/imports")({
  ssr: false,
  component: ImportsPage,
});

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

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    let batchId: string | null = null;
    try {
      // Guard: JSON only, size cap
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

  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Imports</h1>
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
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b: Record<string, unknown>) => (
              <tr key={String(b.id)} className="border-t">
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(String(b.created_at)).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{String(b.original_filename ?? "—")}</div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round(Number(b.file_size ?? 0) / 1024)} KB
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">
                  <StatusPill status={String(b.status)} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {String(b.total_items ?? 0)} total ·{" "}
                  <span className="text-emerald-600">{String(b.inserted_items ?? 0)} new</span> ·{" "}
                  <span className="text-blue-600">{String(b.updated_items ?? 0)} upd</span> ·{" "}
                  <span className="text-amber-600">{String(b.skipped_items ?? 0)} skip</span> ·{" "}
                  <span className="text-destructive">{String(b.failed_items ?? 0)} fail</span>
                </td>
                <td className="px-3 py-2 text-xs text-destructive max-w-[280px] truncate">
                  {String(b.error_message ?? "")}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to="/$lang/_authenticated/admin/imports/$id"
                        params={{ lang, id: String(b.id) }}
                      >
                        Open
                      </Link>
                    </Button>
                    {["uploaded", "analyzing", "ready", "importing"].includes(String(b.status)) && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => cancelMut.mutate(String(b.id))}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No imports yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    uploaded: "bg-blue-100 text-blue-700",
    analyzing: "bg-blue-100 text-blue-700",
    ready: "bg-amber-100 text-amber-700",
    importing: "bg-amber-100 text-amber-700",
    completed: "bg-emerald-100 text-emerald-700",
    partially_completed: "bg-amber-100 text-amber-700",
    failed: "bg-destructive/10 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${tone[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}
