import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { DirectoryEmptyState } from "@/components/directory/DirectoryEmptyState";
import { DirectoryPagination } from "@/components/directory/DirectoryPagination";
import { MapToggle } from "@/components/map/MapToggle";
import { SearchBar } from "@/components/search/SearchBar";
import { SeoContent } from "@/components/seo/SeoContent";
import { Badge } from "@/components/ui/badge";
import { buildHreflang, canonicalFor, ogLocaleFor } from "@/lib/seo/hreflang";
import { breadcrumbJsonLd, businessItemListJsonLd, collectionPageJsonLd, safeJsonLdStringify } from "@/lib/seo/jsonld";
import { pickLocalized, translate, type Locale } from "@/lib/i18n";
import { RESERVED_LANG_CHILD_SLUGS } from "@/types/domain";

/**
 * A single dynamic segment under a locale — resolves to a category listing
 * OR a city landing page. Reserved paths (search, place, admin, etc.) are
 * matched by their own explicit route files and never reach this loader.
 */
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

const slugQuery = (slug: string, page: number) =>
  queryOptions({
    queryKey: ["lang-slug", slug, page],
    queryFn: async () => {
      if (RESERVED_LANG_CHILD_SLUGS.has(slug)) throw notFound();
      const [category, city] = await Promise.all([
        services.categories.getBySlug(slug),
        services.cities.getBySlug(slug),
      ]);
      if (category) {
        const [result, cities] = await Promise.all([
          services.businesses.list({ category: slug, sort: "recommended", page }),
          services.cities.list(),
        ]);
        return { kind: "category" as const, category, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize, nav: cities };
      }
      if (city) {
        const [result, categories] = await Promise.all([
          services.businesses.list({ city: slug, sort: "recommended", page }),
          services.categories.list(),
        ]);
        return { kind: "city" as const, city, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize, nav: categories };
      }
      throw notFound();
    },
  });

export const Route = createFileRoute("/$lang/$slug")({
  validateSearch: validateDirectorySearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(slugQuery(params.slug, deps.search.page)),
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
        children: safeJsonLdStringify(s),
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
  const search = Route.useSearch();
  const navigate = useNavigate();
  const locale = lang as Locale;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const { data } = useSuspenseQuery(slugQuery(slug, search.page));

  const heading =
    data.kind === "category"
      ? pickLocalized(data.category.name, locale)
      : pickLocalized(data.city.name, locale);
  const navigationTitle =
    data.kind === "category" ? t("filters.city") : t("filters.category");

  function setView(view: "list" | "map") {
    navigate({
      to: "/$lang/$slug",
      params: { lang, slug },
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
          {data.total.toLocaleString()} {t("common.results")}
        </p>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label={navigationTitle}>
        {data.nav.slice(0, 12).map((item) => (
          <a
            key={item.id}
            href={
              data.kind === "category"
                ? `/${locale}/${item.slug}/${data.category.slug}`
                : `/${locale}/${data.city.slug}/${item.slug}`
            }
          >
            <Badge variant="outline">
              {pickLocalized(item.name, locale)}
            </Badge>
          </a>
        ))}
      </nav>

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
