import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { DirectoryEmptyState } from "@/components/directory/DirectoryEmptyState";
import { DirectoryPagination } from "@/components/directory/DirectoryPagination";
import { MapToggle } from "@/components/map/MapToggle";
import { SearchBar } from "@/components/search/SearchBar";
import { buildHreflang, canonicalFor, ogLocaleFor } from "@/lib/seo/hreflang";
import { breadcrumbJsonLd, businessItemListJsonLd, collectionPageJsonLd } from "@/lib/seo/jsonld";
import { pickLocalized, translate, type Locale } from "@/lib/i18n";

interface DirectorySearchParams {
  page: number;
  view: "list" | "map";
}

function validateDirectorySearch(raw: Record<string, unknown>): DirectorySearchParams {
  const rawPage = typeof raw.page === "number" ? raw.page : Number(raw.page);
  return {
    page: Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1),
    view: raw.view === "map" ? "map" : "list",
  };
}

const cityCategoryQuery = (citySlug: string, categorySlug: string, page: number) =>
  queryOptions({
    queryKey: ["city-category", citySlug, categorySlug, page],
    queryFn: async () => {
      const [city, category] = await Promise.all([
        services.cities.getBySlug(citySlug),
        services.categories.getBySlug(categorySlug),
      ]);
      if (!city || !category) throw notFound();
      const result = await services.businesses.list({
        city: citySlug,
        category: categorySlug,
        sort: "recommended",
        page,
      });
      return { city, category, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize };
    },
  });

export const Route = createFileRoute("/$lang/$citySlug/$categorySlug")({
  validateSearch: validateDirectorySearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      cityCategoryQuery(params.citySlug, params.categorySlug, deps.search.page),
    ),
  head: ({ params, loaderData }) => {
    const locale = params.lang as Locale;
    const path = `/${params.citySlug}/${params.categorySlug}`;
    if (!loaderData) return { meta: [{ title: translate(locale, "notfound.title") }] };
    const catName = pickLocalized(loaderData.category.name, locale);
    const cityName = pickLocalized(loaderData.city.name, locale);
    const title = `${catName} · ${cityName} — ${translate(locale, "brand.name")}`;
    const desc = `${catName} — ${cityName}. ${translate(locale, "hero.subtitle")}`;
    const siteUrl = canonicalFor(locale, path);
    const scripts = [
      breadcrumbJsonLd([
        { label: translate(locale, "breadcrumb.home"), url: canonicalFor(locale, "/") },
        { label: cityName, url: canonicalFor(locale, `/${params.citySlug}`) },
        { label: catName, url: siteUrl },
      ]),
      collectionPageJsonLd(siteUrl, title, desc, loaderData.total),
      businessItemListJsonLd(loaderData.items, (business) => canonicalFor(locale, `/place/${business.slug}`)),
    ];
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: siteUrl },
        { property: "og:locale", content: ogLocaleFor(locale) },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: desc },
      ],
      links: [
        { rel: "canonical", href: siteUrl },
        ...buildHreflang(path),
      ],
      scripts: scripts.map((s) => ({
        type: "application/ld+json",
        children: JSON.stringify(s),
      })),
    };
  },
  component: CityCategoryPage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-20 text-center">Not found</div>
  ),
});

function CityCategoryPage() {
  const { lang, citySlug, categorySlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const locale = lang as Locale;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const { data } = useSuspenseQuery(cityCategoryQuery(citySlug, categorySlug, search.page));
  const cityName = pickLocalized(data.city.name, locale);
  const catName = pickLocalized(data.category.name, locale);

  function setView(view: "list" | "map") {
    navigate({
      to: "/$lang/$citySlug/$categorySlug",
      params: { lang, citySlug, categorySlug },
      search: (prev) => ({
        ...validateDirectorySearch(prev),
        view,
      }),
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("breadcrumb.home"), to: "/" },
          { label: cityName, to: `/${citySlug}` },
          { label: catName },
        ]}
      />
      <h1 className="mt-4 text-2xl font-bold sm:text-3xl">
        {catName} · {cityName}
      </h1>
      <div className="mt-6">
        <SearchBar variant="compact" />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        {data.total.toLocaleString()} {t("common.results")}
      </p>
      {data.items.length === 0 ? (
        <div className="mt-6">
          <DirectoryEmptyState />
        </div>
      ) : (
        <>
          <MapToggle
            className="mt-4"
            businesses={data.items}
            total={data.total}
            view={search.view}
            onViewChange={setView}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.items.map((b, i) => (
                <BusinessCard key={b.id} business={b} eager={i < 4} />
              ))}
            </div>
          </MapToggle>
          <DirectoryPagination
            className="mt-8"
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
          />
        </>
      )}
    </div>
  );
}
