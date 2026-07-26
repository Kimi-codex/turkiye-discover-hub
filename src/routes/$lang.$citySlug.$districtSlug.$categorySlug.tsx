import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { DirectoryEmptyState } from "@/components/directory/DirectoryEmptyState";
import { DirectoryPagination } from "@/components/directory/DirectoryPagination";
import { MapToggle } from "@/components/map/MapToggle";
import { buildHreflang, canonicalFor, ogLocaleFor } from "@/lib/seo/hreflang";
import { breadcrumbJsonLd, businessItemListJsonLd, collectionPageJsonLd, safeJsonLdStringify } from "@/lib/seo/jsonld";
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

const cityDistrictCategoryQuery = (
  citySlug: string,
  districtSlug: string,
  categorySlug: string,
  page: number,
) =>
  queryOptions({
    queryKey: ["city-district-category", citySlug, districtSlug, categorySlug, page],
    queryFn: async () => {
      const city = await services.cities.getBySlug(citySlug);
      if (!city) throw notFound();
      const [district, category] = await Promise.all([
        services.cities.getDistrictBySlug(city.id, districtSlug),
        services.categories.getBySlug(categorySlug),
      ]);
      if (!district || !category) throw notFound();
      const result = await services.businesses.list({
        city: citySlug,
        district: districtSlug,
        category: categorySlug,
        sort: "recommended",
        page,
      });
      return { city, district, category, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize };
    },
  });

export const Route = createFileRoute(
  "/$lang/$citySlug/$districtSlug/$categorySlug",
)({
  validateSearch: validateDirectorySearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      cityDistrictCategoryQuery(
        params.citySlug,
        params.districtSlug,
        params.categorySlug,
        deps.search.page,
      ),
    ),
  head: ({ params, loaderData }) => {
    const locale = params.lang as Locale;
    const path = `/${params.citySlug}/${params.districtSlug}/${params.categorySlug}`;
    if (!loaderData) return { meta: [{ title: translate(locale, "notfound.title") }] };
    const cat = pickLocalized(loaderData.category.name, locale);
    const dist = pickLocalized(loaderData.district.name, locale);
    const city = pickLocalized(loaderData.city.name, locale);
    const title = `${cat} · ${dist}, ${city} — ${translate(locale, "brand.name")}`;
    const desc = `${cat} in ${dist}, ${city}.`;
    const siteUrl = canonicalFor(locale, path);
    const scripts = [
      breadcrumbJsonLd([
        { label: translate(locale, "breadcrumb.home"), url: canonicalFor(locale, "/") },
        { label: city, url: canonicalFor(locale, `/${params.citySlug}`) },
        { label: cat, url: canonicalFor(locale, `/${params.citySlug}/${params.categorySlug}`) },
        { label: dist, url: siteUrl },
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
        children: safeJsonLdStringify(s),
      })),
    };
  },
  component: CityDistrictCategoryPage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-20 text-center">Not found</div>
  ),
});

function CityDistrictCategoryPage() {
  const { lang, citySlug, districtSlug, categorySlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const locale = lang as Locale;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const { data } = useSuspenseQuery(
    cityDistrictCategoryQuery(citySlug, districtSlug, categorySlug, search.page),
  );
  const cityName = pickLocalized(data.city.name, locale);
  const districtName = pickLocalized(data.district.name, locale);
  const catName = pickLocalized(data.category.name, locale);

  function setView(view: "list" | "map") {
    navigate({
      to: "/$lang/$citySlug/$districtSlug/$categorySlug",
      params: { lang, citySlug, districtSlug, categorySlug },
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
          { label: catName, to: `/${citySlug}/${categorySlug}` },
          { label: districtName },
        ]}
      />
      <h1 className="mt-4 text-2xl font-bold sm:text-3xl">
        {catName} · {districtName}, {cityName}
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        {data.total.toLocaleString()} {t("common.results")}
      </p>
      {data.items.length === 0 ? (
        <div className="mt-6">
          <DirectoryEmptyState />
        </div>
      ) : (
        <>
          <MapToggle
            className="mt-6"
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
