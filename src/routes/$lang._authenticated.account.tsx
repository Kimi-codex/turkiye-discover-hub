import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useT, useLocaleContext } from "@/lib/i18n";
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
