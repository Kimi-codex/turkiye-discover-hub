import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { DirectoryEmptyState } from "@/components/directory/DirectoryEmptyState";
import { DirectoryPagination } from "@/components/directory/DirectoryPagination";
import { FiltersPanel } from "@/components/search/FiltersPanel";
import { MapToggle } from "@/components/map/MapToggle";
import { ClarificationCard } from "@/components/search/ClarificationCard";
import { DidYouMean } from "@/components/search/DidYouMean";
import { InterpretationChips } from "@/components/search/InterpretationChips";
import { SortSelect } from "@/components/search/SortSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildHreflang, canonicalFor, ogLocaleFor } from "@/lib/seo/hreflang";
import { pickLocalized, translate, useLocale, useT, type Locale } from "@/lib/i18n";
import {
  parseDirectorySearchIntent,
  queryForParsedSearchIntent,
  pickClarifyingQuestion,
  type ParsedIntent,
  type InterpretationChip,
} from "@/lib/search/parseIntent";
import { normalizePublicSearchFilters } from "@/lib/search/search-filters";
import { removePublicSearchChip } from "@/lib/search/search-url-state";
import type { SearchFilters, SortOption, Category } from "@/types/domain";
import { supabase } from "@/integrations/supabase/client";

interface SearchParams {
  q: string;
  category: string | null;
  city: string | null;
  district: string | null;
  rating: number | null;
  priceLevel: number | null;
  audience: string | null;
  intent: string | null;
  clarify: string | null;
  sort: SortOption;
  page: number;
  view: "list" | "map";
}

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
    q: asStr(raw.q),
    category: asStr(raw.category) || null,
    city: asStr(raw.city) || null,
    district: asStr(raw.district) || null,
    rating: asNum(raw.rating),
    priceLevel: asNum(raw.priceLevel),
    audience: asStr(raw.audience) || null,
    intent: asStr(raw.intent) || null,
    clarify: asStr(raw.clarify) || null,
    sort,
    page: Math.max(1, asNum(raw.page) ?? 1),
    view: asStr(raw.view) === "map" ? "map" : "list",
  };
}

const searchDictQuery = () =>
  queryOptions({
    queryKey: ["search", "dict"],
    queryFn: async () => {
      const [categories, cities] = await Promise.all([
        services.categories.list(),
        services.cities.list(),
      ]);
      // Load districts for matched cities lazily - here we fetch for the top featured cities.
      const districtLists = await Promise.all(
        cities.map((c) => services.cities.listDistricts(c.id)),
      );

      // Load category aliases from the search_aliases table
      const categoryAliases: Record<string, string[]> = {};
      try {
        const qb = (supabase as any).from("search_aliases");
        const { data: aliasRows } = await qb
          .select("entity_id, alias, entity_type")
          .eq("entity_type", "category");
        if (aliasRows) {
          for (const row of aliasRows) {
            const cat = categories.find((c: Category) => c.id === row.entity_id);
            if (cat) {
              (categoryAliases[cat.slug] ??= []).push(row.alias);
            }
          }
        }
      } catch {
        // Table may not exist yet — fall back to hardcoded aliases
      }

      return { categories, cities, districts: districtLists.flat(), categoryAliases };
    },
    staleTime: 5 * 60_000,
  });

function queryForFilters(params: SearchParams, intent?: ParsedIntent): string {
  if (!intent) return params.q;
  return queryForParsedSearchIntent(intent);
}

function toFilters(params: SearchParams, intent?: ParsedIntent): SearchFilters {
  return normalizePublicSearchFilters({
    query: queryForFilters(params, intent),
    category: params.category ?? intent?.matchedCategorySlug,
    city: params.city ?? intent?.matchedCitySlug,
    district: params.district ?? intent?.matchedDistrictSlug,
    rating: params.rating,
    openNow: false,
    priceLevel: params.priceLevel,
    sort: params.sort,
    page: params.page,
  });
}

const searchQuery = (filters: SearchFilters) =>
  queryOptions({
    queryKey: ["search", filters],
    queryFn: () => services.businesses.list(filters),
  });

export const Route = createFileRoute("/$lang/search")({
  validateSearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ context, deps, params }) => {
    const dict = await context.queryClient.ensureQueryData(searchDictQuery());
    const intent = parseDirectorySearchIntent(deps.search.q, params.lang as Locale, dict);
    await context.queryClient.ensureQueryData(searchQuery(toFilters(deps.search, intent)));
  },
  head: ({ params }) => {
    const locale = params.lang as Locale;
    const title = `${translate(locale, "search.your_results")} — ${translate(locale, "brand.name")}`;
    const desc = translate(locale, "home.subtitle");
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: canonicalFor(locale, "/search") },
        { property: "og:locale", content: ogLocaleFor(locale) },
        { name: "robots", content: "noindex, follow" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: desc },
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
  const params = Route.useSearch();
  const navigate = useNavigate();
  const locale = useLocale();
  const t = useT();
  const [dismissedClarify, setDismissedClarify] = useState(false);

  const { data: dict } = useSuspenseQuery(searchDictQuery());
  const intent = useMemo(
    () => parseDirectorySearchIntent(params.q, locale, dict),
    [params.q, locale, dict],
  );

  // Merge URL params with parsed intent (URL wins if user explicitly set anything).
  // When descriptiveIntent is true the remaining query is only a descriptor
  // (e.g. "fancy", "غالي") — do NOT apply it as a mandatory ILIKE filter.
  const effectiveFilters: SearchFilters = useMemo(() => {
    return normalizePublicSearchFilters({
      query: queryForParsedSearchIntent(intent),
      category: params.category ?? intent.matchedCategorySlug,
      city: params.city ?? intent.matchedCitySlug,
      district: params.district ?? intent.matchedDistrictSlug,
      rating: params.rating ?? (intent.ratingIntent === "top" ? 4.3 : null),
      openNow: false,
      priceLevel: params.priceLevel ?? intent.priceLevel,
      sort: params.sort,
      page: params.page,
    });
  }, [params, intent]);

  const { data } = useSuspenseQuery(searchQuery(effectiveFilters));

  // If zero results but intent has narrowing chips, relax by dropping district+price.
  const relaxedFilters = useMemo<SearchFilters | null>(() => {
    if (data.total > 0) return null;
    if (!effectiveFilters.district && !effectiveFilters.priceLevel) return null;
    return { ...effectiveFilters, district: null, priceLevel: null };
  }, [data.total, effectiveFilters]);
  const { data: relaxedData } = useSuspenseQuery(
    searchQuery(relaxedFilters ?? effectiveFilters),
  );
  const showRelaxed = !!relaxedFilters && relaxedData && relaxedData.total > 0;
  const displayed = showRelaxed ? relaxedData : data;
  const hasActiveSearch = Boolean(
    params.q ||
      params.category ||
      params.city ||
      params.district ||
      params.rating ||
      params.priceLevel ||
      params.audience,
  );

  const chips: InterpretationChip[] = intent.interpretation;
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    const category = dict.categories.find((c) => c.slug === effectiveFilters.category);
    const city = dict.cities.find((c) => c.slug === effectiveFilters.city);
    const district = dict.districts.find((d) => d.slug === effectiveFilters.district);
    if (category) labels.push(pickLocalized(category.name, locale));
    if (city) labels.push(pickLocalized(city.name, locale));
    if (district) labels.push(pickLocalized(district.name, locale));
    if (effectiveFilters.rating) labels.push(`${effectiveFilters.rating}+`);
    if (effectiveFilters.priceLevel) labels.push("$".repeat(effectiveFilters.priceLevel));
    return labels;
  }, [dict, effectiveFilters, locale]);
  const clarifyQuestion = pickClarifyingQuestion(intent);
  const showClarify =
    !dismissedClarify &&
    !params.clarify &&
    displayed.items.length > 0 &&
    intent.confidence !== "high";

  function removeChip(chip: InterpretationChip) {
    navigate({
      to: "/$lang/search",
      params: { lang: locale },
      search: (prev: Record<string, unknown>) => removePublicSearchChip(validateSearch(prev), chip, intent) as unknown as SearchParams,
    });
  }

  function handleClarify(answer: string) {
    setDismissedClarify(true);
    navigate({
      to: "/$lang/search",
      params: { lang: locale },
      search: (prev: Record<string, unknown>) => ({ ...validateSearch(prev), clarify: answer, page: 1 }),
    });
  }

  function clearAll() {
    navigate({
      to: "/$lang/search",
      params: { lang: locale },
      search: validateSearch({}),
    });
  }

  function setView(view: "list" | "map") {
    navigate({
      to: "/$lang/search",
      params: { lang: locale },
      search: (prev: Record<string, unknown>) => ({
        ...validateSearch(prev),
        view,
      }),
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("search.your_results")}
        </p>
        <h1 className="font-display text-2xl font-bold text-primary sm:text-3xl">
          {params.q || t("search.button")}
        </h1>
        {chips.length > 0 && (
          <InterpretationChips
            chips={chips}
            onRemove={removeChip}
            className="mt-2"
          />
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {displayed.total.toLocaleString()} {t("common.results")}
          </span>
          {activeFilterLabels.map((label) => (
            <Badge key={label} variant="secondary">
              {label}
            </Badge>
          ))}
          {hasActiveSearch && (
            <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
              {t("filters.clear")}
            </Button>
          )}
        </div>
      </div>

      {showClarify && (
        <ClarificationCard
          className="mt-6"
          query={params.q}
          questionKey={clarifyQuestion}
          onAnswer={handleClarify}
          onSkip={() => setDismissedClarify(true)}
        />
      )}

      {showRelaxed && (
        <p className="mt-6 text-sm text-muted-foreground">{t("search.relaxed")}</p>
      )}

      {displayed.items.length < 3 && params.q && (
        <DidYouMean
          query={params.q}
          resultCount={displayed.items.length}
          className="mt-4"
        />
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <FiltersPanel
          filters={effectiveFilters}
          categories={dict.categories}
          cities={dict.cities}
          districts={dict.districts}
        />
        <section aria-label={t("search.your_results")}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {displayed.total.toLocaleString()} {t("common.results")}
            </p>
            <SortSelect value={effectiveFilters.sort} />
          </div>

          {displayed.items.length === 0 ? (
            hasActiveSearch ? <EmptyState /> : <CleanSearchState />
          ) : (
            <>
              <MapToggle
                businesses={displayed.items}
                total={displayed.total}
                view={params.view}
                onViewChange={setView}
              >
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {displayed.items.map((b, i) => (
                    <BusinessCard key={b.id} business={b} eager={i < 2} highlightQuery={params.q} />
                  ))}
                </div>
              </MapToggle>
              <DirectoryPagination
                className="mt-8"
                page={displayed.page}
                pageSize={displayed.pageSize}
                total={displayed.total}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <DirectoryEmptyState
      title={t("search.no_results.title")}
      description={t("search.no_results.desc")}
    />
  );
}

function CleanSearchState() {
  const t = useT();
  return (
    <DirectoryEmptyState title={t("search.button")} description={t("home.subtitle")} />
  );
}
