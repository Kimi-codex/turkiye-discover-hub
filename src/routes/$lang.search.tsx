import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { services } from "@/lib/repos";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ClarificationCard } from "@/components/search/ClarificationCard";
import { InterpretationChips } from "@/components/search/InterpretationChips";
import { buildHreflang, canonicalFor } from "@/lib/seo/hreflang";
import { translate, useLocale, useT, type Locale } from "@/lib/i18n";
import {
  parseDirectorySearchIntent,
  pickClarifyingQuestion,
  type ParsedIntent,
  type InterpretationChip,
  type SearchDictionary,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  if (intent.descriptiveIntent) return "";
  return intent.remainingQuery;
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
    const title = `${translate(locale, "search.your_results")} ? ${translate(locale, "home.badge")}`;
    const desc = translate(locale, "home.subtitle");
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
      query: intent.descriptiveIntent ? "" : intent.remainingQuery,
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

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
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

      <div className="mt-8">
        {displayed.items.length === 0 ? (
          hasActiveSearch ? <EmptyState /> : <CleanSearchState />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {displayed.items.map((b, i) => (
              <BusinessCard key={b.id} business={b} eager={i < 2} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
      <h2 className="text-lg font-semibold">{t("search.no_results.title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("search.no_results.desc")}
      </p>
    </div>
  );
}

function CleanSearchState() {
  const t = useT();
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
      <h2 className="text-lg font-semibold">{t("search.button")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("home.subtitle")}</p>
    </div>
  );
}
