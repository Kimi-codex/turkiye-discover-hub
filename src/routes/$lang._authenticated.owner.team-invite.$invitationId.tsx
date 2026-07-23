import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2 } from "lucide-react";
import { acceptBusinessTeamInvitation } from "@/lib/owner/owner.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/team-invite/$invitationId")({
  ssr: false,
  component: AcceptTeamInvitation,
});

function AcceptTeamInvitation() {
  const { lang, invitationId } = Route.useParams();
  const search = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  const accept = useServerFn(acceptBusinessTeamInvitation);
  const mutation = useMutation({
    mutationFn: () =>
      accept({
        data: {
          invitationId,
          token: search.token ?? "",
        },
      }),
    onSuccess: (res: any) => {
      toast.success("Invitation accepted");
      navigate({ to: `/${lang}/owner/${res.row.business_id}`, replace: true });
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Accept team invitation</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Accept this invitation with the same email address it was sent to.
        </p>
        <Button
          className="mt-6 w-full"
          onClick={() => mutation.mutate()}
          disabled={!search.token || mutation.isPending}
        >
          {mutation.isPending ? "Accepting..." : "Accept invitation"}
        </Button>
        {!search.token ? (
          <p className="mt-3 text-sm text-destructive">This invitation link is missing its token.</p>
        ) : null}
      </div>
    </div>
  );
}
