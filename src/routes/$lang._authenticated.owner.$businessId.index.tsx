import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getOwnedBusiness,
  listMyChangeRequests,
} from "@/lib/owner/owner.functions";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/")({
  ssr: false,
  component: Overview,
});

function Overview() {
  const { businessId } = useParams({ strict: false }) as { businessId: string };
  const fetchBiz = useServerFn(getOwnedBusiness);
  const listCrs = useServerFn(listMyChangeRequests);
  const biz = useQuery({
    queryKey: ["owner:biz", businessId],
    queryFn: () => fetchBiz({ data: { businessId } }),
  });
  const crs = useQuery({
    queryKey: ["owner:crs", businessId],
    queryFn: () => listCrs({ data: { businessId } }),
  });
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 font-medium">Status</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt>Status</dt><dd><Badge variant="outline">{biz.data?.business.status}</Badge></dd></div>
          <div className="flex justify-between"><dt>Verified</dt><dd>{biz.data?.business.verified ? "yes" : "no"}</dd></div>
          <div className="flex justify-between"><dt>Rating</dt><dd>{biz.data?.business.rating ?? "—"}</dd></div>
          <div className="flex justify-between"><dt>Reviews</dt><dd>{biz.data?.business.review_count ?? 0}</dd></div>
          <div className="flex justify-between"><dt>Images</dt><dd>{biz.data?.images.length ?? 0}</dd></div>
        </dl>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 font-medium">Recent change requests</h2>
        {(crs.data?.rows ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {crs.data!.rows.slice(0, 6).map((c: { id: string; request_type: string; status: string; created_at: string }) => (
              <li key={c.id} className="flex justify-between border-b pb-1 last:border-0">
                <span>{c.request_type}</span>
                <Badge variant="outline">{c.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
