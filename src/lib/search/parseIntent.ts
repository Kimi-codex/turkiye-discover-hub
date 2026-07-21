import type { Category, City, District, Locale } from "@/types/domain";
import { pickLocalized } from "@/lib/i18n";

export interface ParsedIntent {
  rawQuery: string;
  normalizedQuery: string;
  matchedCategorySlug: string | null;
  matchedCitySlug: string | null;
  matchedDistrictSlug: string | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  ratingIntent: "top" | null;
  audienceIntent: "family" | null;
  remainingKeywords: string[];
  confidence: "high" | "medium" | "low";
  interpretation: InterpretationChip[];
}

export interface InterpretationChip {
  key: string;
  label: string;
  /** Which URL param this chip owns (removing it wipes that param). */
  urlParam:
    | "category"
    | "city"
    | "district"
    | "priceLevel"
    | "rating"
    | "audience";
}

export interface SearchDictionary {
  categories: Category[];
  cities: City[];
  districts: District[];
}

const RATING_WORDS = [
  "best",
  "top",
  "top-rated",
  "en iyi",
  "en güzel",
  "en gozel",
  "en iyisi",
  "أفضل",
  "الافضل",
  "الأفضل",
];

const FAMILY_WORDS = [
  "family",
  "families",
  "kids",
  "aile",
  "aileler",
  "çocuk",
  "cocuk",
  "عائلي",
  "عائلة",
  "عائلية",
  "أطفال",
];

const BUDGET_WORDS: Record<string, 1 | 2 | 3 | 4> = {
  cheap: 1,
  budget: 1,
  affordable: 1,
  ekonomik: 1,
  ucuz: 1,
  رخيص: 1,
  اقتصادي: 1,
  "mid-budget": 2,
  midbudget: 2,
  "mid-range": 2,
  midrange: 2,
  orta: 2,
  متوسط: 2,
  premium: 3,
  upscale: 3,
  luxury: 4,
  luxurious: 4,
  luks: 4,
  lüks: 4,
  فاخر: 4,
  فخم: 4,
};

/** Lightweight normalization: NFKC, lowercase, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .normalize("NFKC")
    .toLocaleLowerCase("tr")
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/[’'`´]/g, " ")
    .replace(/[.,;:!?()\[\]{}"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** True if any query token matches the needle exactly, or one is a 4+ char prefix of the other. */
function containsWord(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (!n) return false;
  const qTokens = tokens(haystack);
  const nTokens = tokens(n);
  if (nTokens.length === 0) return false;
  // Multi-word label: require the sequence to appear contiguously.
  if (nTokens.length > 1) {
    return ` ${haystack} `.includes(` ${n} `);
  }
  const nt = nTokens[0]!;
  return qTokens.some((qt) => {
    if (qt === nt) return true;
    if (nt.length >= 4 && qt.startsWith(nt)) return true;
    if (qt.length >= 4 && nt.startsWith(qt)) return true;
    return false;
  });
}

interface Named {
  slug: string;
  name: import("@/types/domain").LocalizedString;
}

function findMatch<T extends Named>(
  haystack: string,
  items: T[],
  locale: Locale,
): T | null {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const labels = new Set<string>();
    labels.add(item.slug.replace(/-/g, " "));
    for (const l of ["tr", "en", "ar"] as Locale[]) {
      const v = item.name[l];
      if (v) labels.add(v);
    }
    const pref = pickLocalized(item.name, locale);
    if (pref) labels.add(pref);
    for (const label of labels) {
      if (containsWord(haystack, label)) {
        scored.push({ item, score: normalize(label).length });
        break;
      }
    }
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.item;
}

export function parseDirectorySearchIntent(
  query: string,
  locale: Locale,
  dict: SearchDictionary,
): ParsedIntent {
  const raw = query ?? "";
  const norm = normalize(raw);

  const matchedCategory = findMatch(norm, dict.categories, locale);
  const matchedCity = findMatch(norm, dict.cities, locale);
  const districtsForCity = matchedCity
    ? dict.districts.filter((d) => d.cityId === matchedCity.id)
    : dict.districts;
  const matchedDistrict = findMatch(norm, districtsForCity, locale);

  // Price / rating / audience intents
  let priceLevel: 1 | 2 | 3 | 4 | null = null;
  const dollarCount = (raw.match(/\$/g) ?? []).length;
  if (dollarCount >= 1 && dollarCount <= 4) {
    priceLevel = dollarCount as 1 | 2 | 3 | 4;
  } else {
    for (const [word, level] of Object.entries(BUDGET_WORDS)) {
      if (containsWord(norm, word)) {
        priceLevel = level;
        break;
      }
    }
  }

  const ratingIntent = RATING_WORDS.some((w) => containsWord(norm, w))
    ? ("top" as const)
    : null;
  const audienceIntent = FAMILY_WORDS.some((w) => containsWord(norm, w))
    ? ("family" as const)
    : null;

  // Remove matched tokens to compute remaining keywords
  let residual = ` ${norm} `;
  const stripLabels = new Set<string>();
  if (matchedCategory) {
    stripLabels.add(pickLocalized(matchedCategory.name, locale));
    stripLabels.add(matchedCategory.slug.replace(/-/g, " "));
  }
  if (matchedCity) {
    stripLabels.add(pickLocalized(matchedCity.name, locale));
    stripLabels.add(matchedCity.slug.replace(/-/g, " "));
  }
  if (matchedDistrict) {
    stripLabels.add(pickLocalized(matchedDistrict.name, locale));
    stripLabels.add(matchedDistrict.slug.replace(/-/g, " "));
  }
  for (const l of stripLabels) {
    const n = normalize(l);
    if (n) residual = residual.replace(new RegExp(`\\s${n}\\s`, "g"), " ");
  }
  const remaining = residual
    .trim()
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 2 &&
        !RATING_WORDS.includes(w) &&
        !FAMILY_WORDS.includes(w) &&
        !Object.keys(BUDGET_WORDS).includes(w) &&
        !["in", "at", "on", "the", "de", "da", "te", "ta", "en", "iyi", "en iyi", "في"].includes(w),
    );

  const strongHits =
    (matchedCategory ? 1 : 0) +
    (matchedCity ? 1 : 0) +
    (matchedDistrict ? 1 : 0);
  const confidence: ParsedIntent["confidence"] =
    strongHits >= 2 ? "high" : strongHits === 1 ? "medium" : "low";

  const interpretation: InterpretationChip[] = [];
  if (matchedCategory) {
    interpretation.push({
      key: `cat-${matchedCategory.slug}`,
      label: pickLocalized(matchedCategory.name, locale),
      urlParam: "category",
    });
  }
  if (matchedCity) {
    interpretation.push({
      key: `city-${matchedCity.slug}`,
      label: pickLocalized(matchedCity.name, locale),
      urlParam: "city",
    });
  }
  if (matchedDistrict) {
    interpretation.push({
      key: `dist-${matchedDistrict.slug}`,
      label: pickLocalized(matchedDistrict.name, locale),
      urlParam: "district",
    });
  }
  if (ratingIntent === "top") {
    interpretation.push({
      key: "rating-top",
      label: locale === "tr" ? "En iyi" : locale === "ar" ? "الأفضل" : "Top rated",
      urlParam: "rating",
    });
  }
  if (priceLevel !== null) {
    interpretation.push({
      key: `price-${priceLevel}`,
      label: "$".repeat(priceLevel),
      urlParam: "priceLevel",
    });
  }
  if (audienceIntent === "family") {
    interpretation.push({
      key: "audience-family",
      label:
        locale === "tr" ? "Aile dostu" : locale === "ar" ? "عائلي" : "Family-friendly",
      urlParam: "audience",
    });
  }

  return {
    rawQuery: raw,
    normalizedQuery: norm,
    matchedCategorySlug: matchedCategory?.slug ?? null,
    matchedCitySlug: matchedCity?.slug ?? null,
    matchedDistrictSlug: matchedDistrict?.slug ?? null,
    priceLevel,
    ratingIntent,
    audienceIntent,
    remainingKeywords: remaining,
    confidence,
    interpretation,
  };
}

/**
 * Pick a clarification question for the parsed intent. Returns a message key
 * so the caller resolves it via useT() with the correct locale.
 */
export function pickClarifyingQuestion(
  intent: ParsedIntent,
): import("@/lib/i18n").MessageKey {
  const cat = intent.matchedCategorySlug;
  if (cat === "hotels") {
    if (intent.priceLevel === null) return "search.q.hotel_budget";
    if (!intent.matchedDistrictSlug) return "search.q.hotel_district";
    return "search.q.hotel_dates";
  }
  if (cat === "restaurants" || cat === "cafes") {
    return "search.q.restaurant_cuisine";
  }
  if (cat === "clinics" || cat === "health" || cat === "hospitals") {
    return intent.matchedDistrictSlug
      ? "search.q.clinic_specialty"
      : "search.q.clinic_district";
  }
  return "search.q.default";
}
