import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { services } from "@/lib/repos";
import { SearchBar } from "@/components/search/SearchBar";
import { FiltersPanel } from "@/components/search/FiltersPanel";
import { SortSelect } from "@/components/search/SortSelect";
import { BusinessCard, BusinessCardSkeleton } from "@/components/business/BusinessCard";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { buildHreflang, canonicalFor } from "@/lib/seo/hreflang";
import { translate, type Locale } from "@/lib/i18n";
import type { SearchFilters, SortOption } from "@/types/domain";

type SearchParams = SearchFilters;

const VALID_SORTS: SortOption[] = [
  "recommended",
  "highest_rated",
  "most_reviewed",
  "recently_added",
  "name",
];

function validateSearch(raw: Record<string, unknown>): SearchParams {
  const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
  const asNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
      return Number(v);
    return null;
  };
  const sortRaw = asStr(raw.sort);
  const sort: SortOption = (VALID_SORTS as string[]).includes(sortRaw)
    ? (sortRaw as SortOption)
    : "recommended";
  return {
    query: asStr(raw.q),
    category: asStr(raw.category) || null,
    city: asStr(raw.city) || null,
    district: asStr(raw.district) || null,
    rating: asNum(raw.rating),
    openNow: raw.openNow === true || raw.openNow === "true" || raw.openNow === "1",
    priceLevel: asNum(raw.priceLevel),
    sort,
    page: Math.max(1, asNum(raw.page) ?? 1),
  };
}

const searchQuery = (filters: SearchParams) =>
  queryOptions({
    queryKey: ["search", filters],
    queryFn: () => services.businesses.list(filters),
  });

export const Route = createFileRoute("/$lang/search")({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(searchQuery(deps)),
  head: ({ params }) => {
    const locale = params.lang as Locale;
    const title = `${translate(locale, "breadcrumb.search")} — ${translate(locale, "brand.name")}`;
    const desc = translate(locale, "hero.subtitle");
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: canonicalFor(locale, "/search") },
        { name: "robots", content: "noindex, follow" },
      ],
      links: [
        { rel: "canonical", href: canonicalFor(locale, "/search") },
        ...buildHreflang("/search"),
      ],
    };
  },
  component: SearchPage,
});

function SearchPage() {
  const filters = Route.useSearch();
  const { data } = useSuspenseQuery(searchQuery(filters));
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { lang } = Route.useParams();
  const t = (k: Parameters<typeof translate>[1]) => translate(lang as Locale, k);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("breadcrumb.home"), to: "/" },
          { label: t("breadcrumb.search") },
        ]}
      />

      <div className="mt-4">
        <SearchBar
          variant="compact"
          initialQuery={filters.query}
          initialLocation={filters.city ?? ""}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold sm:text-xl">
            {data.total.toLocaleString()} {t("common.results")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 lg:hidden">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                {t("filters.title")}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[92vw] max-w-sm overflow-y-auto p-4">
              <SheetHeader className="mb-2">
                <SheetTitle>{t("filters.title")}</SheetTitle>
              </SheetHeader>
              <FiltersPanel
                filters={filters}
                onClose={() => setMobileFiltersOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <SortSelect value={filters.sort} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <FiltersPanel filters={filters} />
        </div>
        <div>
          {data.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((b, i) => (
                <BusinessCard key={b.id} business={b} eager={i < 3} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const { lang } = Route.useParams();
  const t = (k: Parameters<typeof translate>[1]) => translate(lang as Locale, k);
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <h2 className="text-lg font-semibold">{t("search.no_results.title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("search.no_results.desc")}
      </p>
    </div>
  );
}

// keep the skeleton import used at least once (types/tree-shaking)
export const _skeletonRef = BusinessCardSkeleton;
