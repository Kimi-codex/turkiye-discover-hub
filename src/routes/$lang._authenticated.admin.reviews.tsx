import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listReviewsAdmin, setReviewStatusAdmin } from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const STATUSES = ["pending", "published", "hidden", "rejected"] as const;

export const Route = createFileRoute("/$lang/_authenticated/admin/reviews")({
  ssr: false,
  component: ReviewsPage,
});

function ReviewsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("pending");
  const [source, setSource] = useState<string>("");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["admin", "reviews", { status, source, page }],
    queryFn: () =>
      listReviewsAdmin({
        data: { status: status || undefined, source: source || undefined, page },
      }),
  });
  const mut = useMutation({
    mutationFn: (v: { id: string; status: (typeof STATUSES)[number]; adminNotes?: string }) =>
      setReviewStatusAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "reviews"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reviews</h1>
        <div className="flex gap-2">
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Any source</option>
            <option value="platform">Platform</option>
            <option value="google">Google</option>
          </select>
        </div>
      </div>
      <div className="space-y-3">
        {rows.map((r: Record<string, unknown>) => (
          <div key={String(r.id)} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">
                  {String((r.businesses as { name?: string } | null)?.name ?? "—")}{" "}
                  <span className="text-xs text-muted-foreground">· {String(r.source)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {String(r.author_name ?? "Anonymous")} · ★ {String(r.rating)} ·{" "}
                  {new Date(String(r.created_at)).toLocaleDateString()}
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{String(r.review_text ?? "")}</p>
              </div>
              <div className="flex flex-col gap-1">
                {STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={r.status === s ? "default" : "outline"}
                    disabled={mut.isPending}
                    onClick={() => mut.mutate({ id: String(r.id), status: s })}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && !q.isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">No reviews</div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Prev
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button size="sm" variant="outline" disabled={rows.length < 50} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
