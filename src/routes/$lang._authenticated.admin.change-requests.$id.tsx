import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getChangeRequestAdmin,
  applyChangeRequest,
} from "@/lib/owner/admin-cr.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/change-requests/$id")({
  ssr: false,
  component: ChangeRequestDetail,
});

function ChangeRequestDetail() {
  const { id, lang } = useParams({ strict: false }) as { id: string; lang: string };
  const navigate = useNavigate();
  const fetchCr = useServerFn(getChangeRequestAdmin);
  const apply = useServerFn(applyChangeRequest);
  const q = useQuery({
    queryKey: ["admin:cr", id],
    queryFn: () => fetchCr({ data: { id } }),
  });
  const [approve, setApprove] = useState<Set<string>>(new Set());
  const [reject, setReject] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [conflict, setConflict] = useState<{ field: string; current: unknown; snapshot: unknown } | null>(null);

  const fields = fieldsFromCr(q.data?.cr);
  useEffect(() => {
    if (q.data && approve.size === 0 && reject.size === 0) {
      setApprove(new Set(fields));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      apply({
        data: {
          id,
          approve: [...approve],
          reject: [...reject],
          adminNotes: notes || undefined,
        },
      }),
    onSuccess: (res: { conflict?: boolean; field?: string; current?: unknown; snapshot?: unknown; ok?: boolean; status?: string }) => {
      if (res?.conflict) {
        setConflict({ field: res.field!, current: res.current, snapshot: res.snapshot });
        toast.error(`Conflict on field ${res.field} — refresh and re-review.`);
      } else {
        toast.success(`Applied: ${res.status}`);
        navigate({ to: `/${lang}/admin/change-requests` });
      }
    },
    onError: (e) => toast.error(e instanceof Response ? `HTTP ${e.status}` : String(e)),
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const cr = q.data!.cr as {
    id: string; request_type: string; status: string; changes: Record<string, unknown>;
    original_values: Record<string, unknown>; created_at: string;
    businesses: { id: string; name: string; slug: string } | null;
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Change request · {cr.request_type}</h1>
        <p className="text-sm text-muted-foreground">
          {cr.businesses?.name} · <Badge variant="outline">{cr.status}</Badge>
        </p>
      </header>

      {conflict && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <div className="font-medium">Stale-value conflict on {conflict.field}</div>
          <pre className="mt-2 overflow-x-auto text-xs">current: {JSON.stringify(conflict.current)}</pre>
          <pre className="text-xs">snapshot: {JSON.stringify(conflict.snapshot)}</pre>
        </div>
      )}

      <div className="rounded-xl border bg-card p-4">
        {fields.map((f) => (
          <div key={f} className="flex items-start justify-between gap-4 border-b py-2 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{f}</div>
              <div className="text-xs text-muted-foreground">
                {cr.request_type === "business_fields" ? (
                  <>from <code>{JSON.stringify(cr.original_values?.[f] ?? null)}</code> → <code>{JSON.stringify(cr.changes?.[f] ?? null)}</code></>
                ) : (
                  <code className="block overflow-x-auto">{JSON.stringify(cr.changes?.[f] ?? null)}</code>
                )}
              </div>
            </div>
            <div className="flex gap-2 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio" name={`f_${f}`} checked={approve.has(f)}
                  onChange={() => {
                    const a = new Set(approve); a.add(f); setApprove(a);
                    const r = new Set(reject); r.delete(f); setReject(r);
                  }}
                /> Approve
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio" name={`f_${f}`} checked={reject.has(f)}
                  onChange={() => {
                    const r = new Set(reject); r.add(f); setReject(r);
                    const a = new Set(approve); a.delete(f); setApprove(a);
                  }}
                /> Reject
              </label>
            </div>
          </div>
        ))}
      </div>

      <div>
        <Textarea placeholder="Admin notes (owner will see this)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate()} disabled={mut.isPending || cr.status !== "pending"}>
          {mut.isPending ? "Applying…" : "Apply decision"}
        </Button>
      </div>
    </div>
  );
}

function fieldsFromCr(cr: unknown): string[] {
  if (!cr) return [];
  const c = cr as { request_type: string; changes: Record<string, unknown> | null };
  if (c.request_type === "business_fields") return Object.keys(c.changes ?? {});
  if (c.request_type === "opening_hours") return ["opening_hours"];
  if (c.request_type === "services") return ["services"];
  if (c.request_type === "attributes") return ["attributes"];
  if (c.request_type === "translations") return ["translations"];
  if (c.request_type === "image_request") return ["image_request"];
  return [];
}
