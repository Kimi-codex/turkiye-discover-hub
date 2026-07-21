import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listChangeRequestsAdmin } from "@/lib/owner/admin-cr.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/$lang/_authenticated/admin/change-requests")({
  ssr: false,
  component: ChangeRequestsList,
});

function ChangeRequestsList() {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const list = useServerFn(listChangeRequestsAdmin);
  const [status, setStatus] = useState("pending");
  const [rt, setRt] = useState("");
  const q = useQuery({
    queryKey: ["admin:crs", status, rt],
    queryFn: () => list({ data: { status, requestType: rt || undefined } }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Change requests</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border px-2 py-1 text-sm">
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="partially_approved">partially_approved</option>
          <option value="rejected">rejected</option>
          <option value="withdrawn">withdrawn</option>
          <option value="all">all</option>
        </select>
        <select value={rt} onChange={(e) => setRt(e.target.value)} className="rounded border px-2 py-1 text-sm">
          <option value="">any type</option>
          <option value="business_fields">business_fields</option>
          <option value="opening_hours">opening_hours</option>
          <option value="services">services</option>
          <option value="attributes">attributes</option>
          <option value="translations">translations</option>
          <option value="image_request">image_request</option>
        </select>
      </div>
      <div className="rounded-xl border bg-card">
        {(q.data?.rows ?? []).map((r: { id: string; request_type: string; status: string; created_at: string; businesses: { name: string; slug: string } | null }) => (
          <div key={r.id} className="flex items-center justify-between border-b p-3 text-sm last:border-0">
            <div>
              <div className="font-medium">{r.businesses?.name ?? r.id}</div>
              <div className="text-xs text-muted-foreground">{r.request_type} · {new Date(r.created_at).toLocaleString()}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{r.status}</Badge>
              <Button asChild size="sm" variant="outline">
                <Link to={`/${lang}/admin/change-requests/${r.id}`}>Review</Link>
              </Button>
            </div>
          </div>
        ))}
        {(q.data?.rows ?? []).length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No results.</div>
        )}
      </div>
    </div>
  );
}
