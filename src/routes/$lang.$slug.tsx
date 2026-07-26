import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { SearchBar } from "@/components/search/SearchBar";
import { SeoContent } from "@/components/seo/SeoContent";
import { buildHreflang, canonicalFor, ogLocaleFor } from "@/lib/seo/hreflang";
import { breadcrumbJsonLd, businessItemListJsonLd, collectionPageJsonLd } from "@/lib/seo/jsonld";
import { pickLocalized, translate, type Locale } from "@/lib/i18n";
import { RESERVED_LANG_CHILD_SLUGS } from "@/types/domain";

/**
 * A single dynamic segment under a locale — resolves to a category listing
 * OR a city landing page. Reserved paths (search, place, admin, etc.) are
 * matched by their own explicit route files and never reach this loader.
 */
const slugQuery = (slug: string) =>
  queryOptions({
    queryKey: ["lang-slug", slug],
    queryFn: async () => {
      if (RESERVED_LANG_CHILD_SLUGS.has(slug)) throw notFound();
      const [category, city] = await Promise.all([
        services.categories.getBySlug(slug),
        services.cities.getBySlug(slug),
      ]);
      if (category) {
        const items = await services.businesses.getByCategory(slug, 24);
        return { kind: "category" as const, category, items };
      }
      if (city) {
        const items = await services.businesses.getByCity(slug, 24);
        return { kind: "city" as const, city, items };
      }
      throw notFound();
    },
  });

export const Route = createFileRoute("/$lang/$slug")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(slugQuery(params.slug)),
  head: ({ params, loaderData }) => {
    const locale = params.lang as Locale;
    const path = `/${params.slug}`;
    if (!loaderData) {
      return {
        meta: [{ title: translate(locale, "notfound.title") }],
      };
    }
    const name =
      loaderData.kind === "category"
        ? pickLocalized(loaderData.category.name, locale)
        : pickLocalized(loaderData.city.name, locale);
    const title = `${name} — ${translate(locale, "brand.name")}`;
    const desc =
      loaderData.kind === "category"
        ? `${name} — ${translate(locale, "hero.subtitle")}`
        : `${name}: ${translate(locale, "hero.subtitle")}`;
    const siteUrl = canonicalFor(locale, path);
    const scripts: Record<string, unknown>[] = [
      breadcrumbJsonLd([
        { label: translate(locale, "breadcrumb.home"), url: canonicalFor(locale, "/") },
        { label: name, url: siteUrl },
      ]),
      collectionPageJsonLd(siteUrl, name, desc, loaderData.items.length),
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
        ...(loaderData.kind === "city" && loaderData.city.imageUrl
          ? [{ property: "og:image", content: loaderData.city.imageUrl }]
          : []),
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
  component: LangSlugPage,
  notFoundComponent: NotFound,
});

function NotFound() {
  const { lang } = Route.useParams();
  return (
    <div className="mx-auto flex min-h-[40dvh] max-w-md flex-col items-center justify-center px-4 py-20 text-center">
      <h1 className="text-xl font-bold">
        {translate(lang as Locale, "notfound.title")}
      </h1>
    </div>
  );
}

function LangSlugPage() {
  const { lang, slug } = Route.useParams();
  const locale = lang as Locale;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const { data } = useSuspenseQuery(slugQuery(slug));

  const heading =
    data.kind === "category"
      ? pickLocalized(data.category.name, locale)
      : pickLocalized(data.city.name, locale);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("breadcrumb.home"), to: "/" },
          { label: heading },
        ]}
      />
      {data.kind === "city" && data.city.imageUrl ? (
        <div className="relative mt-4 aspect-[21/8] overflow-hidden rounded-3xl">
          <img
            src={data.city.imageUrl}
            alt={heading}
            className="h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/20 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 p-6 text-primary-foreground sm:p-8">
            <h1 className="text-2xl font-bold sm:text-4xl">{heading}</h1>
          </div>
        </div>
      ) : (
        <h1 className="mt-4 text-2xl font-bold sm:text-3xl">{heading}</h1>
      )}

      {data.kind === "category" && data.category.description && (
        <div className="mt-4">
          <SeoContent
            content={pickLocalized(data.category.description, locale)}
            originalContent={pickLocalized(data.category.description, "en")}
          />
        </div>
      )}
      {data.kind === "city" && data.city.description && (
        <div className="mt-4">
          <SeoContent
            content={pickLocalized(data.city.description, locale)}
            originalContent={pickLocalized(data.city.description, "en")}
          />
        </div>
      )}

      <div className="mt-6">
        <SearchBar variant="compact" />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data.items.length.toLocaleString()} {t("common.results")}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.items.map((b, i) => (
          <BusinessCard key={b.id} business={b} eager={i < 4} />
        ))}
      </div>
    </div>
  );
}
