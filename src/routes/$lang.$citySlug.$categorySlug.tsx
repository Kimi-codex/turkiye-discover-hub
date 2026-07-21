import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { SearchBar } from "@/components/search/SearchBar";
import { buildHreflang, canonicalFor } from "@/lib/seo/hreflang";
import { pickLocalized, translate, type Locale } from "@/lib/i18n";

const cityCategoryQuery = (citySlug: string, categorySlug: string) =>
  queryOptions({
    queryKey: ["city-category", citySlug, categorySlug],
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
        page: 1,
      });
      return { city, category, items: result.items, total: result.total };
    },
  });

export const Route = createFileRoute("/$lang/$citySlug/$categorySlug")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      cityCategoryQuery(params.citySlug, params.categorySlug),
    ),
  head: ({ params, loaderData }) => {
    const locale = params.lang as Locale;
    const path = `/${params.citySlug}/${params.categorySlug}`;
    if (!loaderData) return { meta: [{ title: translate(locale, "notfound.title") }] };
    const catName = pickLocalized(loaderData.category.name, locale);
    const cityName = pickLocalized(loaderData.city.name, locale);
    const title = `${catName} · ${cityName} — ${translate(locale, "brand.name")}`;
    const desc = `${catName} — ${cityName}. ${translate(locale, "hero.subtitle")}`;
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
  component: CityCategoryPage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-20 text-center">Not found</div>
  ),
});

function CityCategoryPage() {
  const { lang, citySlug, categorySlug } = Route.useParams();
  const locale = lang as Locale;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const { data } = useSuspenseQuery(cityCategoryQuery(citySlug, categorySlug));
  const cityName = pickLocalized(data.city.name, locale);
  const catName = pickLocalized(data.category.name, locale);

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
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.items.map((b, i) => (
          <BusinessCard key={b.id} business={b} eager={i < 4} />
        ))}
      </div>
    </div>
  );
}
