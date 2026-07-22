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
import { useT, type MessageKey } from "@/lib/i18n";

export const Route = createFileRoute("/$lang/_authenticated/owner/")({
  ssr: false,
  component: OwnerHome,
});

function OwnerHome() {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const t = useT();
  const listBiz = useServerFn(listMyBusinesses);
  const listClaims = useServerFn(listMyOwnershipClaims);
  const listNotifs = useServerFn(listOwnerNotifications);
  const biz = useQuery({ queryKey: ["owner:my-businesses"], queryFn: () => listBiz() });
  const claims = useQuery({ queryKey: ["owner:my-claims"], queryFn: () => listClaims() });
  const notifs = useQuery({ queryKey: ["owner:notifications"], queryFn: () => listNotifs() });

  return (
    <OwnerShell>
      <div className="space-y-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t("owner.home.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("owner.home.subtitle")}</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/$lang/owner/onboarding" params={{ lang }}>
              {t("owner.home.onboarding")}
            </Link>
          </Button>
        </header>

        <section>
          <h2 className="mb-3 text-lg font-medium">{t("owner.home.businesses")}</h2>
          {biz.isLoading ? (
            <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
          ) : (biz.data?.rows ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t("owner.home.no_businesses")}
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {biz.data!.rows.map(
                (b: {
                  id: string;
                  name: string;
                  slug: string;
                  status: string;
                  verified: boolean;
                  featured: boolean;
                  rating: number | null;
                  review_count: number;
                }) => (
                  <li key={b.id} className="rounded-lg border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-muted-foreground">/{b.slug}</div>
                      </div>
                      <div className="flex gap-1">
                        {b.verified && <Badge variant="secondary">{t("card.verified")}</Badge>}
                        {b.featured && <Badge>{t("card.featured")}</Badge>}
                        <Badge variant="outline">{t(`onboarding.status.${b.status}` as MessageKey)}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t("owner.home.rating", {
                        rating: (b.rating ?? 0).toFixed(1),
                        count: b.review_count,
                      })}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/$lang/owner/$businessId" params={{ lang, businessId: b.id }}>
                          {t("owner.home.manage")}
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/$lang/owner/$businessId/reviews" params={{ lang, businessId: b.id }}>
                          {t("owner.home.reviews")}
                        </Link>
                      </Button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">{t("owner.home.legacy_claims")}</h2>
          {(claims.data?.rows ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {t("owner.home.no_claims")}
            </div>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {claims.data!.rows.map(
                (c: {
                  id: string;
                  business_id: string;
                  status: string;
                  created_at: string;
                  admin_notes: string | null;
                }) => (
                  <li key={c.id} className="flex items-center justify-between p-3 text-sm">
                    <div>
                      <div className="font-medium">{c.business_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString(lang)}
                      </div>
                    </div>
                    <Badge variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "outline"}>
                      {t(`onboarding.status.${c.status}` as MessageKey)}
                    </Badge>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">
            {t("owner.home.notifications")}{" "}
            {notifs.data?.unread ? <Badge variant="destructive">{notifs.data.unread}</Badge> : null}
          </h2>
          <div className="rounded-lg border bg-card">
            {(notifs.data?.rows ?? []).slice(0, 5).map((n: { id: string; kind: string; created_at: string }) => (
              <div key={n.id} className="flex items-center justify-between border-b p-3 text-sm last:border-0">
                <span>{t("owner.home.notification_item")}</span>
                <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString(lang)}</span>
              </div>
            ))}
            {(notifs.data?.rows ?? []).length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">{t("owner.home.no_notifications")}</div>
            )}
          </div>
        </section>
      </div>
    </OwnerShell>
  );
}
