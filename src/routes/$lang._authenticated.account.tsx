import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, Compass, Settings, UserRound, Store, ClipboardList, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAccountState } from "@/hooks/use-account-state";
import { useT, useLocaleContext, type MessageKey } from "@/lib/i18n";
import { LocaleLink } from "@/components/site/LocaleLink";
import { getBusinessImageUrl } from "@/lib/images/storage";

type CoverRow = { source_url: string | null; r2_url: string | null; is_cover: boolean; sort_order: number } | undefined;

function coverUrlFromRow(cover: CoverRow, businessId: string): string {
  if (!cover) return getBusinessImageUrl(null);
  return getBusinessImageUrl({
    id: "",
    businessId,
    placeId: "",
    sourceUrl: cover.source_url ?? null,
    r2Key: null,
    r2Url: cover.r2_url ?? null,
    storageStatus: "external_only",
    imageType: "cover",
    isCover: true,
    sortOrder: 0,
  });
}

export const Route = createFileRoute("/$lang/_authenticated/account")({
  head: () => ({
    meta: [{ title: "Hesabım · TurkeyDirect" }, { name: "robots", content: "noindex" }],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, signOut } = useAuth();
  const { locale } = useLocaleContext();
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {
    state,
    profile,
    onboarding,
    memberships,
    notifications,
    favorites,
    queries,
  } = useAccountState();

  const removeFav = useMutation({
    mutationFn: async (businessId: string) => {
      const { error } = await supabase.from("favorites").delete().eq("business_id", businessId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await signOut();
    toast.success(t("auth.signed_out"));
    navigate({ to: `/${locale}`, replace: true });
  }

  function statusBadge(status: string) {
    return <Badge variant="outline">{t(`onboarding.status.${status}` as MessageKey)}</Badge>;
  }

  const isApplicant = state === "business_applicant";
  const isOwner = state === "owner" || state === "manager";
  const isExplorer = state === "explorer";
  const isProspect = state === "business_prospect";

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("account.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
          {state === "admin" && (
            <Badge variant="default" className="mt-1">{t("header.admin")}</Badge>
          )}
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          {t("auth.signout")}
        </Button>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            <h2 className="font-semibold">{t("account.summary")}</h2>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("auth.email")}</dt>
              <dd className="truncate">{user?.email}</dd>
            </div>
            {isOwner && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t("account.business_access")}</dt>
                <dd>{memberships.length}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("nav.favorites")}</dt>
              <dd>{favorites.length}</dd>
            </div>
          </dl>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <LocaleLink to="/account/settings">
              <Settings className="h-4 w-4" /> {t("account.settings")}
            </LocaleLink>
          </Button>
          {state === "admin" && (
            <Button asChild variant="default" size="sm" className="mt-2 ml-2">
              <LocaleLink to="/admin">{t("header.admin")}</LocaleLink>
            </Button>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              <h2 className="font-semibold">{t("notifications.title")}</h2>
            </div>
            {notifications.unread ? <Badge variant="destructive">{notifications.unread}</Badge> : null}
          </div>
          {queries.notifications === "error" ? (
            <p className="mt-3 text-sm text-destructive">{t("notifications.error")}</p>
          ) : notifications.rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("notifications.empty")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {notifications.rows.slice(0, 3).map((n: any) => (
                <li key={n.id} className="flex items-start justify-between gap-3">
                  <span className={n.read_at ? "text-muted-foreground" : "font-medium"}>
                    {t(n.title_key as MessageKey)}
                  </span>
                  {!n.read_at ? <span className="mt-1 h-2 w-2 rounded-full bg-primary" /> : null}
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="outline" size="sm" className="mt-4">
            <LocaleLink to="/account/notifications">{t("notifications.open")}</LocaleLink>
          </Button>
        </div>

        {isApplicant && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              <h2 className="font-semibold">{t("account.application_status")}</h2>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {onboarding.map((row: any) => (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <span>{t(`onboarding.type.${row.submission_type}` as MessageKey)}</span>
                  {statusBadge(row.status)}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <LocaleLink to="/owner/onboarding">{t("account.continue_application")}</LocaleLink>
            </Button>
          </div>
        )}

        {isProspect && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4" />
              <h2 className="font-semibold">{t("account.start_application")}</h2>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t("account.start_application_desc")}</p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <LocaleLink to="/owner/onboarding">{t("account.start_application")}</LocaleLink>
            </Button>
          </div>
        )}

        {isExplorer && (
          <div className="rounded-lg border border-dashed bg-card p-4">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4" />
              <h2 className="font-semibold">{t("account.conversion_title")}</h2>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t("account.conversion_description")}</p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <LocaleLink to="/owner/onboarding">
                {t("account.conversion_cta")} <ArrowRight className="ml-1 h-3 w-3" />
              </LocaleLink>
            </Button>
          </div>
        )}

        {isOwner && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <h2 className="font-semibold">{t("account.manage_businesses")}</h2>
            </div>
            {memberships.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {memberships.slice(0, 5).map((m: any) => (
                  <li key={m.businesses?.id ?? m.role} className="truncate">
                    {m.businesses?.name ?? m.role}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t("owner.home.no_businesses")}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <LocaleLink to="/owner">{t("owner.dashboard")}</LocaleLink>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <LocaleLink to="/owner/onboarding">{t("account.add_another_business")}</LocaleLink>
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4" />
            <h2 className="font-semibold">{t("account.next_actions")}</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <LocaleLink to="/search">{t("account.explore")}</LocaleLink>
            </Button>
            {isOwner && (
              <Button asChild size="sm" variant="outline">
                <LocaleLink to="/owner">{t("owner.dashboard")}</LocaleLink>
              </Button>
            )}
            {isOwner && (
              <Button asChild size="sm" variant="outline">
                <LocaleLink to="/owner/onboarding">{t("account.add_another_business")}</LocaleLink>
              </Button>
            )}
            {(isApplicant || isProspect) && (
              <Button asChild size="sm" variant="outline">
                <LocaleLink to="/owner/onboarding">
                  {isApplicant ? t("account.continue_application") : t("account.start_application")}
                </LocaleLink>
              </Button>
            )}
            {isExplorer && (
              <Button asChild size="sm" variant="outline">
                <LocaleLink to="/owner/onboarding">{t("account.conversion_cta")}</LocaleLink>
              </Button>
            )}
          </div>
        </div>
      </section>

      {isApplicant && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">{t("account.recent_activity")}</h2>
          {(onboarding ?? []).flatMap((row: any) => row.events ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("account.no_recent_activity")}</p>
          ) : (
            <ul className="mt-4 divide-y rounded-lg border bg-card">
              {(onboarding ?? [])
                .flatMap((row: any) => (row.events ?? []).map((event: any) => ({ ...event, submissionId: row.id })))
                .slice(0, 5)
                .map((event: any) => (
                  <li key={event.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                    <span>{event.message_key ? t(event.message_key as MessageKey, event.message_params ?? undefined) : event.event_type}</span>
                    <time className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString(locale)}</time>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-semibold">{t("nav.favorites")}</h2>
        {queries.favorites === "loading" && (
          <p className="mt-4 text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {queries.favorites === "error" && (
          <p className="mt-4 text-sm text-destructive">Could not load favorites.</p>
        )}
        {queries.favorites === "success" && favorites.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">{t("account.no_favorites")}</p>
        )}
        {favorites.length > 0 && (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {favorites.map((row: any) => {
              const b = row.businesses;
              if (!b) return null;
              const cover =
                (b.business_images ?? []).find((i: any) => i.is_cover) ??
                (b.business_images ?? [])[0];
              const img = coverUrlFromRow(cover, b.id);
              return (
                <li
                  key={b.id}
                  className="flex gap-3 overflow-hidden rounded-xl border bg-card"
                >
                  <img src={img} alt="" className="h-24 w-24 shrink-0 object-cover" />

                  <div className="flex flex-1 flex-col p-3">
                    <LocaleLink
                      to={`/place/${b.slug}`}
                      className="font-semibold hover:underline"
                    >
                      {b.name}
                    </LocaleLink>
                    <p className="text-xs text-muted-foreground">{b.formatted_address}</p>
                    <div className="mt-auto flex items-center justify-between">
                      <span className="text-sm">★ {Number(b.rating ?? 0).toFixed(1)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeFav.mutate(b.id)}
                      >
                        {t("account.remove")}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
