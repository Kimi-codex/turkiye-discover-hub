import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getOwnedBusiness,
  createOwnerImageUpload,
  registerOwnerImage,
  submitChangeRequest,
} from "@/lib/owner/owner.functions";
import { imageRequestSchema } from "@/lib/owner/field-allowlists";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/images")({
  ssr: false,
  component: OwnerImagesTab,
});

function OwnerImagesTab() {
  const { businessId } = useParams({ strict: false }) as { businessId: string };
  const qc = useQueryClient();
  const fetchBiz = useServerFn(getOwnedBusiness);
  const createUpload = useServerFn(createOwnerImageUpload);
  const registerImg = useServerFn(registerOwnerImage);
  const submit = useServerFn(submitChangeRequest);
  const biz = useQuery({
    queryKey: ["owner:biz", businessId],
    queryFn: () => fetchBiz({ data: { businessId } }),
  });
  const [selectedCover, setSelectedCover] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Set<string>>(new Set());

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { path } = await createUpload({ data: { businessId, fileName: file.name } });
      const { data: signed } = { data: null }; void signed;
      // Actually PUT: reuse createOwnerImageUpload response
      const up = await createUpload({ data: { businessId, fileName: file.name } });
      await fetch(up.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      await registerImg({
        data: {
          businessId,
          storagePath: up.path,
          contentType: file.type || "application/octet-stream",
          title: file.name,
        },
      });
      return path;
    },
    onSuccess: () => {
      toast.success("Uploaded — pending admin approval");
      qc.invalidateQueries({ queryKey: ["owner:biz", businessId] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const submitReq = useMutation({
    mutationFn: () => {
      const payload = imageRequestSchema.parse({
        cover_image_id: selectedCover ?? undefined,
        delete_image_ids: toDelete.size > 0 ? [...toDelete] : undefined,
      });
      return submit({ data: { businessId, requestType: "image_request", payload } });
    },
    onSuccess: () => {
      toast.success("Image request submitted");
      setSelectedCover(null);
      setToDelete(new Set());
      qc.invalidateQueries({ queryKey: ["owner:crs", businessId] });
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <label className="text-sm font-medium">Upload new image (private, awaits approval)</label>
        <input
          type="file" accept="image/*" className="mt-2 block"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium">Images</h3>
          {(selectedCover || toDelete.size > 0) && (
            <Button size="sm" onClick={() => submitReq.mutate()} disabled={submitReq.isPending}>
              Submit change request
            </Button>
          )}
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(biz.data?.images ?? []).map((img: { id: string; is_cover: boolean; storage_status: string; r2_url: string | null }) => {
            const marked = toDelete.has(img.id);
            const cover = selectedCover === img.id || img.is_cover;
            return (
              <li key={img.id} className={`overflow-hidden rounded-md border ${marked ? "opacity-40" : ""}`}>
                <div className="aspect-video bg-muted">
                  {img.r2_url ? <img src={img.r2_url} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <div className="flex items-center justify-between px-2 py-1 text-xs">
                  <Badge variant="outline">{img.storage_status}</Badge>
                  {cover && <Badge>cover</Badge>}
                </div>
                <div className="flex gap-1 border-t p-1">
                  <Button size="sm" variant="ghost" onClick={() => setSelectedCover(img.id)}>Make cover</Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setToDelete((s) => { const n = new Set(s); if (n.has(img.id)) n.delete(img.id); else n.add(img.id); return n; })}
                  >
                    {marked ? "Undelete" : "Delete"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
