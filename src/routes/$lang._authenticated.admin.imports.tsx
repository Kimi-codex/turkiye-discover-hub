import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createImportBatch,
  listImportBatches,
  cancelImportBatch,
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
    try {
      const res = await createImportBatch({
        data: { fileName: file.name, fileSize: file.size, contentType: file.type || "application/json" },
      });
      // Upload directly to signed URL (never through server function)
      const up = await fetch(res.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/json" },
        body: file,
      });
      if (!up.ok) throw new Error(`Upload failed: ${up.status}`);
      toast.success("Uploaded — analyzing…");
      qc.invalidateQueries({ queryKey: ["admin", "imports"] });
      // Navigate to detail so user can trigger analyze/run
      window.location.assign(`/${lang}/admin/imports/${res.batchId}`);
    } catch (e) {
      toast.error((e as Error).message);
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
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Items</th>
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
                  <div className="font-medium">{String(b.file_name ?? "—")}</div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round(Number(b.file_size_bytes ?? 0) / 1024)} KB
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">{String(b.status)}</td>
                <td className="px-3 py-2 text-xs">
                  {String(b.valid_items ?? 0)} valid · {String(b.invalid_items ?? 0)} invalid ·{" "}
                  {String(b.total_items ?? 0)} total
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
                    {["uploading", "analyzed", "running", "paused"].includes(String(b.status)) && (
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
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
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
