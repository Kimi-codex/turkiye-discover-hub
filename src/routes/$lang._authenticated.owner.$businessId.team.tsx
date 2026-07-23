import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  cancelBusinessTeamInvitation,
  inviteBusinessManager,
  listBusinessTeam,
  regenerateBusinessTeamInvitation,
  removeBusinessManager,
} from "@/lib/owner/owner.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/team")({
  ssr: false,
  component: TeamManagement,
});

function TeamManagement() {
  const { lang, businessId } = useParams({ strict: false }) as { lang: string; businessId: string };
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const list = useServerFn(listBusinessTeam);
  const invite = useServerFn(inviteBusinessManager);
  const cancelInvite = useServerFn(cancelBusinessTeamInvitation);
  const regenerateInvite = useServerFn(regenerateBusinessTeamInvitation);
  const removeManager = useServerFn(removeBusinessManager);
  const q = useQuery({
    queryKey: ["owner:team", businessId],
    queryFn: () => list({ data: { businessId } }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["owner:team", businessId] });

  const inviteMutation = useMutation({
    mutationFn: () => invite({ data: { businessId, email } }),
    onSuccess: () => {
      toast.success("Invitation created");
      setEmail("");
      refresh();
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });
  const cancelMutation = useMutation({
    mutationFn: (invitationId: string) => cancelInvite({ data: { businessId, invitationId } }),
    onSuccess: refresh,
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });
  const regenerateMutation = useMutation({
    mutationFn: (invitationId: string) => regenerateInvite({ data: { businessId, invitationId } }),
    onSuccess: refresh,
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeManager({ data: { businessId, memberId } }),
    onSuccess: refresh,
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  const invitationUrl = (id: string, token: string | null) =>
    token
      ? `${window.location.origin}/${lang}/owner/team-invite/${id}?token=${token}`
      : "";

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (q.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
        Only the business owner can manage team membership.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form
        className="rounded-xl border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          inviteMutation.mutate();
        }}
      >
        <h2 className="font-semibold">Invite manager</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Managers can help edit business content through reviewed change requests. Only owners can manage this team.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div>
            <Label htmlFor="manager-email">Email</Label>
            <Input
              id="manager-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="manager@example.com"
            />
          </div>
          <Button type="submit" className="self-end" disabled={inviteMutation.isPending}>
            Invite
          </Button>
        </div>
      </form>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Current members</h2>
        <ul className="mt-4 divide-y">
          {(q.data?.members ?? []).map((member) => (
            <li key={member.membership_id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div>
                <div className="font-medium">{member.email ?? member.user_id}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(member.created_at).toLocaleDateString(lang)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={member.role === "owner" ? "default" : "outline"}>
                  {member.is_primary ? "primary owner" : member.role}
                </Badge>
                {member.role === "manager" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeMutation.mutate(member.membership_id)}
                    disabled={removeMutation.isPending}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Pending invitations</h2>
        {(q.data?.invitations ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No recent invitations.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {q.data!.invitations.map((invitation) => {
              const link = invitationUrl(invitation.id, invitation.token);
              return (
                <li key={invitation.id} className="space-y-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{invitation.email}</div>
                      <div className="text-xs text-muted-foreground">
                        Expires {new Date(invitation.expires_at).toLocaleDateString(lang)}
                      </div>
                    </div>
                    <Badge variant={invitation.status === "pending" ? "outline" : "secondary"}>
                      {invitation.status}
                    </Badge>
                  </div>
                  {link ? (
                    <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                  ) : null}
                  {invitation.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Invitation link copied"))}
                        disabled={!link}
                      >
                        Copy link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => regenerateMutation.mutate(invitation.id)}
                        disabled={regenerateMutation.isPending}
                      >
                        Regenerate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelMutation.mutate(invitation.id)}
                        disabled={cancelMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Ownership transfer is intentionally out of scope for V1.
      </p>
    </div>
  );
}
