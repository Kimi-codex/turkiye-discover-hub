import type { SearchFilters, SortOption } from "@/types/domain";

export const PUBLIC_SEARCH_DEFAULT_PAGE_SIZE = 12;
export const PUBLIC_SEARCH_MAX_PAGE_SIZE = 48;
export const PUBLIC_SEARCH_MAX_QUERY_LENGTH = 160;

export const PUBLIC_SEARCH_SORTS: SortOption[] = [
  "recommended",
  "highest_rated",
  "most_reviewed",
  "recently_added",
  "name",
];

export type PublicSearchFilters = SearchFilters;

function cleanText(value: unknown, maxLength = PUBLIC_SEARCH_MAX_QUERY_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLocaleLowerCase("tr");
  return /^[a-z0-9-]{1,120}$/.test(slug) ? slug : null;
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function cleanRating(value: unknown): number | null {
  const rating = cleanNumber(value);
  if (rating === null) return null;
  return rating >= 1 && rating <= 5 ? rating : null;
}

function cleanPriceLevel(value: unknown): number | null {
  const priceLevel = cleanNumber(value);
  if (priceLevel === null) return null;
  return [1, 2, 3, 4].includes(priceLevel) ? priceLevel : null;
}

function cleanPage(value: unknown): number {
  const page = cleanNumber(value);
  return Math.max(1, Math.floor(page ?? 1));
}

function cleanPageSize(value: unknown): number {
  const pageSize = cleanNumber(value);
  if (pageSize === null) return PUBLIC_SEARCH_DEFAULT_PAGE_SIZE;
  return Math.min(PUBLIC_SEARCH_MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
}

function cleanSort(value: unknown): SortOption {
  return PUBLIC_SEARCH_SORTS.includes(value as SortOption)
    ? (value as SortOption)
    : "recommended";
}

export function normalizePublicSearchFilters(raw: Partial<SearchFilters> = {}): PublicSearchFilters {
  return {
    query: cleanText(raw.query),
    category: cleanSlug(raw.category),
    city: cleanSlug(raw.city),
    district: cleanSlug(raw.district),
    rating: cleanRating(raw.rating),
    openNow: raw.openNow === true,
    priceLevel: cleanPriceLevel(raw.priceLevel),
    sort: cleanSort(raw.sort),
    page: cleanPage(raw.page),
    pageSize: cleanPageSize(raw.pageSize),
  };
}

export function sortColumn(sort: SortOption): { column: string; ascending: boolean } {
  switch (sort) {
    case "highest_rated":
      return { column: "rating", ascending: false };
    case "most_reviewed":
      return { column: "review_count", ascending: false };
    case "recently_added":
      return { column: "created_at", ascending: false };
    case "name":
      return { column: "name", ascending: true };
    case "recommended":
    default:
      return { column: "ranking_score", ascending: false };
  }
}
