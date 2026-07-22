import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listPendingRepliesAdmin,
  moderateReplyAdmin,
} from "@/lib/owner/admin-cr.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/reply-moderation")({
  ssr: false,
  component: ReplyModeration,
});

function ReplyModeration() {
  const qc = useQueryClient();
  const list = useServerFn(listPendingRepliesAdmin);
  const moderate = useServerFn(moderateReplyAdmin);
  const q = useQuery({ queryKey: ["admin:pending-replies"], queryFn: () => list() });
  const m = useMutation({
    mutationFn: (v: { replyId: string; approve: boolean }) => moderate({ data: v }),
    onSuccess: () => {
      toast.success("Decision recorded");
      qc.invalidateQueries({ queryKey: ["admin:pending-replies"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Owner reply moderation</h1>
      <ul className="space-y-3">
        {(q.data?.rows ?? []).map((r: {
          id: string; body: string; created_at: string;
          businesses: { name: string } | null;
          reviews: { rating: number; review_text: string | null } | null;
        }) => (
          <li key={r.id} className="rounded-xl border bg-card p-4">
            <div className="mb-2 text-sm text-muted-foreground">
              {r.businesses?.name} · Review ★{r.reviews?.rating}
            </div>
            {r.reviews?.review_text && (
              <blockquote className="mb-2 border-l-2 pl-2 text-sm italic text-muted-foreground">
                {r.reviews.review_text}
              </blockquote>
            )}
            <p className="text-sm">{r.body}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => m.mutate({ replyId: r.id, approve: true })} disabled={m.isPending}>Approve</Button>
              <Button size="sm" variant="outline" onClick={() => m.mutate({ replyId: r.id, approve: false })} disabled={m.isPending}>Reject</Button>
            </div>
          </li>
        ))}
        {(q.data?.rows ?? []).length === 0 && (
          <li className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No pending replies.</li>
        )}
      </ul>
    </div>
  );
}
