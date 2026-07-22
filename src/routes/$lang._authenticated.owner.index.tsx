import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listMyBusinesses,
  listMyOwnershipClaims,
  listOwnerNotifications,
} from "@/lib/owner/owner.functions";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/$lang/_authenticated/owner/")({
  ssr: false,
  component: OwnerHome,
});

function OwnerHome() {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const listBiz = useServerFn(listMyBusinesses);
  const listClaims = useServerFn(listMyOwnershipClaims);
  const listNotifs = useServerFn(listOwnerNotifications);
  const biz = useQuery({ queryKey: ["owner:my-businesses"], queryFn: () => listBiz() });
  const claims = useQuery({ queryKey: ["owner:my-claims"], queryFn: () => listClaims() });
  const notifs = useQuery({ queryKey: ["owner:notifications"], queryFn: () => listNotifs() });

  return (
    <OwnerShell>
      <div className="space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Owner dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Manage the businesses you own, submit change requests, and reply to reviews.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/$lang/owner/claim" params={{ lang }}>Claim a business</Link>
          </Button>
        </header>

        <section>
          <h2 className="mb-3 text-lg font-medium">Your businesses</h2>
          {biz.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (biz.data?.rows ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              You don&apos;t own any businesses yet. Submit an ownership claim to get started.
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {biz.data!.rows.map((b: {
                id: string; name: string; slug: string; status: string;
                verified: boolean; featured: boolean; rating: number | null; review_count: number;
              }) => (
                <li key={b.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground">/{b.slug}</div>
                    </div>
                    <div className="flex gap-1">
                      {b.verified && <Badge variant="secondary">Verified</Badge>}
                      {b.featured && <Badge>Featured</Badge>}
                      <Badge variant="outline">{b.status}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    ★ {(b.rating ?? 0).toFixed(1)} · {b.review_count} reviews
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/$lang/owner/$businessId" params={{ lang, businessId: b.id }}>Manage</Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/$lang/owner/$businessId/reviews" params={{ lang, businessId: b.id }}>Reviews</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">Claims</h2>
          {(claims.data?.rows ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No claims submitted.
            </div>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {claims.data!.rows.map((c: {
                id: string; business_id: string; status: string; created_at: string; admin_notes: string | null;
              }) => (
                <li key={c.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{c.business_id}</div>
                    <div className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</div>
                  </div>
                  <Badge variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "outline"}>
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">
            Recent notifications{" "}
            {notifs.data?.unread ? <Badge variant="destructive">{notifs.data.unread}</Badge> : null}
          </h2>
          <div className="rounded-lg border bg-card">
            {(notifs.data?.rows ?? []).slice(0, 5).map((n: { id: string; kind: string; created_at: string }) => (
              <div key={n.id} className="flex items-center justify-between border-b p-3 text-sm last:border-0">
                <span>{n.kind}</span>
                <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
              </div>
            ))}
            {(notifs.data?.rows ?? []).length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No notifications.</div>
            )}
          </div>
        </section>
      </div>
    </OwnerShell>
  );
}
