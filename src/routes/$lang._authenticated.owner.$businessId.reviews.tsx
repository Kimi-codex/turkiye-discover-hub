import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listOwnedReviews,
  submitReviewReply,
  withdrawReviewReply,
  ownerSubmitReport,
} from "@/lib/owner/owner.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/reviews")({
  ssr: false,
  component: OwnerReviewsTab,
});

function OwnerReviewsTab() {
  const { businessId } = useParams({ strict: false }) as { businessId: string };
  const qc = useQueryClient();
  const list = useServerFn(listOwnedReviews);
  const send = useServerFn(submitReviewReply);
  const withdraw = useServerFn(withdrawReviewReply);
  const report = useServerFn(ownerSubmitReport);
  const q = useQuery({
    queryKey: ["owner:reviews", businessId],
    queryFn: () => list({ data: { businessId } }),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const reply = useMutation({
    mutationFn: (vars: { reviewId: string; body: string }) =>
      send({ data: { reviewId: vars.reviewId, businessId, body: vars.body } }),
    onSuccess: () => {
      toast.success("Reply submitted — awaiting moderation");
      qc.invalidateQueries({ queryKey: ["owner:reviews", businessId] });
    },
    onError: (e) => toast.error(e instanceof Response ? `${e.status}` : String(e)),
  });
  const wm = useMutation({
    mutationFn: (id: string) => withdraw({ data: { replyId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner:reviews", businessId] }),
  });
  const flag = useMutation({
    mutationFn: (reviewId: string) =>
      report({
        data: {
          businessId,
          reviewId,
          reportType: "review",
          message: "Owner flag — please review",
        },
      }),
    onSuccess: () => toast.success("Reported to moderators"),
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const replies = new Map<string, { id: string; body: string; status: string; author_id: string }>();
  (q.data?.replies ?? []).forEach((r: { id: string; review_id: string; body: string; status: string; author_id: string }) =>
    replies.set(r.review_id, { id: r.id, body: r.body, status: r.status, author_id: r.author_id }));

  return (
    <ul className="space-y-4">
      {(q.data?.reviews ?? []).map((r: { id: string; rating: number; review_text: string | null; created_at: string; user_id: string | null }) => {
        const rep = replies.get(r.id);
        return (
          <li key={r.id} className="rounded-xl border bg-card p-4">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-medium">★ {r.rating}</div>
              <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</div>
            </div>
            {r.review_text && <p className="text-sm">{r.review_text}</p>}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => flag.mutate(r.id)}>Report</Button>
            </div>
            {rep ? (
              <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">Owner reply</span>
                  <Badge variant="outline">{rep.status}</Badge>
                </div>
                <p>{rep.body}</p>
                {rep.status === "pending_review" && (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => wm.mutate(rep.id)}>Withdraw</Button>
                )}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <Textarea
                  rows={2} placeholder="Reply publicly (must be moderated before it appears)"
                  value={drafts[r.id] ?? ""}
                  onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                />
                <Button
                  size="sm" disabled={!(drafts[r.id] ?? "").trim() || reply.isPending}
                  onClick={() => reply.mutate({ reviewId: r.id, body: drafts[r.id] ?? "" })}
                >
                  Submit reply
                </Button>
              </div>
            )}
          </li>
        );
      })}
      {(q.data?.reviews ?? []).length === 0 && (
        <li className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No reviews yet.</li>
      )}
    </ul>
  );
}
