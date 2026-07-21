import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listOwnershipClaimsAdmin,
  approveOwnershipClaimAdmin,
  rejectOwnershipClaimAdmin,
} from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/ownership-claims")({
  ssr: false,
  component: ClaimsPage,
});

function ClaimsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const q = useQuery({
    queryKey: ["admin", "claims", status],
    queryFn: () => listOwnershipClaimsAdmin({ data: { status } }),
  });
  const approve = useMutation({
    mutationFn: (id: string) => approveOwnershipClaimAdmin({ data: { id } }),
    onSuccess: () => {
      toast.success("Approved");
      qc.invalidateQueries({ queryKey: ["admin", "claims"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; reason?: string }) => rejectOwnershipClaimAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["admin", "claims"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ownership claims</h1>
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>
      <div className="space-y-3">
        {rows.map((c: Record<string, unknown>) => (
          <div key={String(c.id)} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">
                  {String((c.businesses as { name?: string } | null)?.name ?? "—")} —{" "}
                  <span className="text-xs text-muted-foreground">{String(c.status)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Claimant: <span className="font-mono">{String(c.user_id)}</span> · submitted{" "}
                  {new Date(String(c.created_at)).toLocaleString()}
                </div>
                <div className="mt-2 text-sm">
                  <strong>Evidence:</strong> {String(c.evidence_notes ?? "—")}
                </div>
                {c.contact_email && (
                  <div className="text-xs text-muted-foreground">Email: {String(c.contact_email)}</div>
                )}
              </div>
              {c.status === "pending" && (
                <div className="flex flex-col gap-1">
                  <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(String(c.id))}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={reject.isPending}
                    onClick={() => {
                      const reason = window.prompt("Reason (optional)") ?? undefined;
                      reject.mutate({ id: String(c.id), reason });
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && !q.isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">No claims</div>
        )}
      </div>
    </div>
  );
}
