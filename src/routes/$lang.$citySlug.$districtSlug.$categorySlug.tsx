import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { buildHreflang, canonicalFor } from "@/lib/seo/hreflang";
import { pickLocalized, translate, type Locale } from "@/lib/i18n";

const cityDistrictCategoryQuery = (
  citySlug: string,
  districtSlug: string,
  categorySlug: string,
) =>
  queryOptions({
    queryKey: ["city-district-category", citySlug, districtSlug, categorySlug],
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
        page: 1,
      });
      return { city, district, category, items: result.items, total: result.total };
    },
  });

export const Route = createFileRoute(
  "/$lang/$citySlug/$districtSlug/$categorySlug",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      cityDistrictCategoryQuery(
        params.citySlug,
        params.districtSlug,
        params.categorySlug,
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
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: canonicalFor(locale, path) },
      ],
      links: [
        { rel: "canonical", href: canonicalFor(locale, path) },
        ...buildHreflang(path),
      ],
    };
  },
  component: CityDistrictCategoryPage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-20 text-center">Not found</div>
  ),
});

function CityDistrictCategoryPage() {
  const { lang, citySlug, districtSlug, categorySlug } = Route.useParams();
  const locale = lang as Locale;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const { data } = useSuspenseQuery(
    cityDistrictCategoryQuery(citySlug, districtSlug, categorySlug),
  );
  const cityName = pickLocalized(data.city.name, locale);
  const districtName = pickLocalized(data.district.name, locale);
  const catName = pickLocalized(data.category.name, locale);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("breadcrumb.home"), to: "/" },
          { label: cityName, to: `/${citySlug}` },
          {
            label: districtName,
            to: `/${citySlug}/${districtSlug}/${categorySlug}`,
          },
          { label: catName },
        ]}
      />
      <h1 className="mt-4 text-2xl font-bold sm:text-3xl">
        {catName} · {districtName}, {cityName}
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        {data.total.toLocaleString()} {t("common.results")}
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.items.map((b, i) => (
          <BusinessCard key={b.id} business={b} eager={i < 4} />
        ))}
      </div>
    </div>
  );
}
