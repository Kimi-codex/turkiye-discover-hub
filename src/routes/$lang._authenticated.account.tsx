import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, Compass, Settings, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useT, useLocaleContext, type MessageKey } from "@/lib/i18n";
import { LocaleLink } from "@/components/site/LocaleLink";
import { getBusinessImageUrl } from "@/lib/images/storage";

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

  const favorites = useQuery({
    queryKey: ["favorites", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select(
          "business_id, created_at, businesses:business_id(id, slug, name, formatted_address, rating, review_count, business_images(source_url, r2_url, is_cover, sort_order))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const removeFav = useMutation({
    mutationFn: async (businessId: string) => {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("business_id", businessId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const notifications = useQuery({
    queryKey: ["user:notifications:summary", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_notifications")
        .select("id, title_key, message_key, message_params, related_business_id, related_submission_id, read_at, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return {
        rows: data ?? [],
        unread: (data ?? []).filter((row: { read_at: string | null }) => !row.read_at).length,
      };
    },
  });

  const onboarding = useQuery({
    queryKey: ["user:onboarding:summary", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("business_onboarding_submissions")
        .select("id, submission_type, status, approved_business_id, updated_at, created_at, events:business_onboarding_events(id, event_type, message_key, message_params, created_at)")
        .eq("applicant_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data ?? [];
    },
  });

  const memberships = useQuery({
    queryKey: ["user:business-memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("business_members")
        .select("role, status, businesses:business_id(id, name, slug)")
        .eq("user_id", user!.id)
        .eq("status", "active")
        .in("role", ["owner", "manager"]);
      if (error) return [];
      return data ?? [];
    },
  });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await signOut();
    toast.success(t("auth.signed_out"));
    navigate({ to: `/${locale}`, replace: true });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("account.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
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
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("account.business_access")}</dt>
              <dd>{memberships.data?.length ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("nav.favorites")}</dt>
              <dd>{favorites.data?.length ?? 0}</dd>
            </div>
          </dl>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <LocaleLink to="/account">
              <Settings className="h-4 w-4" /> {t("account.settings")}
            </LocaleLink>
          </Button>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              <h2 className="font-semibold">{t("notifications.title")}</h2>
            </div>
            {notifications.data?.unread ? <Badge variant="destructive">{notifications.data.unread}</Badge> : null}
          </div>
          {(notifications.data?.rows ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("notifications.empty")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {notifications.data!.rows.slice(0, 3).map((n: any) => (
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

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <h2 className="font-semibold">{t("account.onboarding_status")}</h2>
          </div>
          {(onboarding.data ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("account.no_onboarding")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {onboarding.data!.map((row: any) => (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <span>{t(`onboarding.type.${row.submission_type}` as MessageKey)}</span>
                  <Badge variant="outline">{t(`onboarding.status.${row.status}` as MessageKey)}</Badge>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="outline" size="sm" className="mt-4">
            <LocaleLink to="/owner/onboarding">{t("account.add_manage_business")}</LocaleLink>
          </Button>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4" />
            <h2 className="font-semibold">{t("account.next_actions")}</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <LocaleLink to="/search">{t("account.explore")}</LocaleLink>
            </Button>
            {(memberships.data?.length ?? 0) > 0 ? (
              <Button asChild size="sm" variant="outline">
                <LocaleLink to="/owner">{t("owner.dashboard")}</LocaleLink>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <LocaleLink to="/owner/onboarding">{t("account.add_business")}</LocaleLink>
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">{t("account.recent_activity")}</h2>
        {(onboarding.data ?? []).flatMap((row: any) => row.events ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("account.no_recent_activity")}</p>
        ) : (
          <ul className="mt-4 divide-y rounded-lg border bg-card">
            {(onboarding.data ?? [])
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

      <section className="mt-10">
        <h2 className="text-xl font-semibold">{t("nav.favorites")}</h2>
        {favorites.isLoading && (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        )}
        {!favorites.isLoading && (favorites.data?.length ?? 0) === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("account.no_favorites")}
          </p>
        )}
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {(favorites.data ?? []).map((row: any) => {
            const b = row.businesses;
            if (!b) return null;
            const cover =
              (b.business_images ?? []).find((i: any) => i.is_cover) ??
              (b.business_images ?? [])[0];
            const img = getBusinessImageUrl(
              cover
                ? {
                    id: "",
                    businessId: b.id,
                    placeId: "",
                    sourceUrl: cover.source_url ?? null,
                    r2Key: null,
                    r2Url: cover.r2_url ?? null,
                    storageStatus: "external_only",
                    imageType: "cover",
                    isCover: true,
                    sortOrder: 0,
                  }
                : null,
            );
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
      </section>
    </div>
  );
}
