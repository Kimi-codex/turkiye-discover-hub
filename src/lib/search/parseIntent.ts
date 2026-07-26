import type { Category, City, District, Locale } from "@/types/domain";
import { pickLocalized } from "@/lib/i18n";

export interface ParsedIntent {
  rawQuery: string;
  normalizedQuery: string;
  matchedCategorySlug: string | null;
  matchedCitySlug: string | null;
  matchedDistrictSlug: string | null;
  matchedCategoryTerm: string | null;
  matchedCityTerm: string | null;
  matchedDistrictTerm: string | null;
  matchedPriceTerm: string | null;
  matchedRatingTerm: string | null;
  matchedAudienceTerm: string | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  ratingIntent: "top" | null;
  audienceIntent: "family" | null;
  remainingKeywords: string[];
  remainingQuery: string;
  /** When true, the remaining query consists only of soft descriptors
   *  (adjectives, sentiment, quality words — NOT proper nouns or
   *  business-name-like tokens).  These should influence ranking, not
   *  act as mandatory ILIKE filters that eliminate all results. */
  descriptiveIntent: boolean;
  confidence: "high" | "medium" | "low";
  interpretation: InterpretationChip[];
}

export interface InterpretationChip {
  key: string;
  label: string;
  urlParam:
    | "category"
    | "city"
    | "district"
    | "priceLevel"
    | "rating"
    | "audience";
}

export interface SearchAlias {
  alias: string;
  slug: string;
  languageCode: string;
}

export interface SearchDictionary {
  categories: Category[];
  cities: City[];
  districts: District[];
  /** Optional map from category slug to additional aliases loaded from the DB */
  categoryAliases?: Record<string, string[]>;
}

const CATEGORY_ALIASES: Record<string, string[]> = {
  hotels: ["hotel", "hotels", "otel", "oteller", "فندق", "فنادق"],
  clinics: ["clinic", "clinics", "klinik", "klinikler", "عيادة", "عيادات"],
  restaurants: ["restaurant", "restaurants", "restoran", "restoranlar", "مطعم", "مطاعم"],
  cafes: ["cafe", "cafes", "kafe", "kafeler", "مقهى", "مقاهي"],
};

const EXTRA_CATEGORY_ALIASES: Record<string, string[]> = {
  hotels: ["accommodation", "lodging", "konaklama", "hôtel", "hébergement", "отель", "отели", "гостиница"],
  clinics: ["medical clinic", "dental clinic", "dentist", "dentists", "doctor", "dişçi", "disci", "diş kliniği", "doktor", "clinique", "dentiste", "médecin", "клиника", "стоматолог", "врач"],
  restaurants: ["food", "dining", "eatery", "lokanta", "yemek", "cuisine", "ресторан", "рестораны", "еда"],
  cafes: ["coffee", "coffee shop", "kahve", "café", "cafés", "кофе", "кафе"],
};

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

const SOFT_DESCRIPTOR_WORDS = new Set([
  "راقي",
  "راقية",
  "راقيًا",
  "راقيه",
  "fancy",
  "elegant",
  "upscale",
  "şık",
  "sik",
  "zarif",
  "kaliteli",
]);

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

/** Lightweight normalization that preserves Arabic and Turkish characters. */
export function normalize(input: string): string {
  return input
    .normalize("NFKC")
    .toLocaleLowerCase("tr")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[’'`]/g, " ")
    .replace(/[.,;:!()[\]{}"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

function containsWord(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (!n) return false;
  const queryTokens = tokens(haystack);
  const needleTokens = tokens(n);
  if (needleTokens.length > 1) return ` ${haystack} `.includes(` ${n} `);
  const target = needleTokens[0];
  if (!target) return false;
  return queryTokens.some((queryToken) => {
    if (queryToken === target) return true;
    if (queryToken.length < 3 || target.length < 3) return false;
    let i = 0;
    while (i < Math.min(queryToken.length, target.length) && queryToken[i] === target[i]) i++;
    return i >= 4;
  });
}

interface Named {
  slug: string;
  name: import("@/types/domain").LocalizedString;
}

interface NamedMatch<T extends Named> {
  item: T;
  matchedText: string;
}

function findMatchedText(haystack: string, label: string): string | null {
  const normalizedLabel = normalize(label);
  const labelTokens = tokens(normalizedLabel);
  const haystackTokens = tokens(haystack);
  if (labelTokens.length > 1) {
    return ` ${haystack} `.includes(` ${normalizedLabel} `) ? normalizedLabel : null;
  }
  const target = labelTokens[0];
  if (!target) return null;
  return haystackTokens.find((queryToken) => {
    if (queryToken === target) return true;
    if (queryToken.length < 3 || target.length < 3) return false;
    let i = 0;
    while (i < Math.min(queryToken.length, target.length) && queryToken[i] === target[i]) i++;
    return i >= 4;
  }) ?? null;
}

function findMatch<T extends Named>(
  haystack: string,
  items: T[],
  locale: Locale,
  additionalAliases?: Record<string, string[]>,
): NamedMatch<T> | null {
  const scored: Array<{ item: T; score: number; matchedText: string }> = [];
  for (const item of items) {
    const labels = new Set<string>();
    labels.add(item.slug.replace(/-/g, " "));
    const mergedAliases = new Set<string>();
    for (const alias of additionalAliases?.[item.slug] ?? []) mergedAliases.add(alias);
    for (const alias of CATEGORY_ALIASES[item.slug] ?? []) mergedAliases.add(alias);
    for (const alias of EXTRA_CATEGORY_ALIASES[item.slug] ?? []) mergedAliases.add(alias);
    for (const alias of mergedAliases) labels.add(alias);
    for (const language of ["tr", "en", "ar", "fr", "ru"] as Locale[]) {
      const value = item.name[language];
      if (value) labels.add(value);
    }
    const preferred = pickLocalized(item.name, locale);
    if (preferred) labels.add(preferred);
    for (const label of labels) {
      const matchedText = findMatchedText(haystack, label);
      if (matchedText) {
        scored.push({ item, score: normalize(label).length, matchedText });
        break;
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

function removeTerm(input: string, term: string | null): string {
  if (!term) return input;
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return input;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return input.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), "$1 ").replace(/\s+/g, " ").trim();
}

export function removeConsumedIntentTerm(
  query: string,
  intent: ParsedIntent,
  urlParam: InterpretationChip["urlParam"],
): string {
  const term =
    urlParam === "category"
      ? intent.matchedCategoryTerm
      : urlParam === "city"
        ? intent.matchedCityTerm
        : urlParam === "district"
          ? intent.matchedDistrictTerm
          : urlParam === "priceLevel"
            ? intent.matchedPriceTerm
            : urlParam === "rating"
              ? intent.matchedRatingTerm
              : urlParam === "audience"
                ? intent.matchedAudienceTerm
                : null;
  if (urlParam === "priceLevel" && intent.rawQuery.includes("$")) {
    return normalize(query).replace(/\$/g, "").replace(/\s+/g, " ").trim();
  }
  return removeTerm(normalize(query), term);
}

export function parseDirectorySearchIntent(query: string, locale: Locale, dict: SearchDictionary): ParsedIntent {
  const raw = query ?? "";
  const norm = normalize(raw);
  const matchedCategory = findMatch(norm, dict.categories, locale, dict.categoryAliases);
  const matchedCity = findMatch(norm, dict.cities, locale);
  const districtsForCity = matchedCity
    ? dict.districts.filter((district) => district.cityId === matchedCity.item.id)
    : dict.districts;
  const matchedDistrict = findMatch(norm, districtsForCity, locale);

  let priceLevel: 1 | 2 | 3 | 4 | null = null;
  let matchedPriceTerm: string | null = null;
  const dollarCount = (raw.match(/\$/g) ?? []).length;
  if (dollarCount >= 1 && dollarCount <= 4) {
    priceLevel = dollarCount as 1 | 2 | 3 | 4;
    matchedPriceTerm = "$";
  } else {
    for (const [word, level] of Object.entries(BUDGET_WORDS)) {
      if (containsWord(norm, word)) {
        priceLevel = level;
        matchedPriceTerm = findMatchedText(norm, word);
        break;
      }
    }
  }

  const matchedRatingTerm = RATING_WORDS.map((word) => findMatchedText(norm, word)).find(Boolean) ?? null;
  const matchedAudienceTerm = FAMILY_WORDS.map((word) => findMatchedText(norm, word)).find(Boolean) ?? null;
  const ratingIntent = matchedRatingTerm ? ("top" as const) : null;
  const audienceIntent = matchedAudienceTerm ? ("family" as const) : null;

  let residual = norm;
  residual = removeTerm(residual, matchedCategory?.matchedText ?? null);
  residual = removeTerm(residual, matchedCity?.matchedText ?? null);
  residual = removeTerm(residual, matchedDistrict?.matchedText ?? null);

  const remaining = tokens(residual).filter((word) => {
    const normalizedWord = normalize(word);
    return (
      normalizedWord.length >= 2 &&
      !RATING_WORDS.some((candidate) => normalize(candidate) === normalizedWord) &&
      !FAMILY_WORDS.some((candidate) => normalize(candidate) === normalizedWord) &&
      !Object.keys(BUDGET_WORDS).some((candidate) => normalize(candidate) === normalizedWord) &&
      !SOFT_DESCRIPTOR_WORDS.has(normalizedWord) &&
      !["in", "at", "on", "the", "de", "da", "te", "ta", "en", "iyi", "في"].includes(normalizedWord)
    );
  });

  const strongHits = (matchedCategory ? 1 : 0) + (matchedCity ? 1 : 0) + (matchedDistrict ? 1 : 0);
  const confidence: ParsedIntent["confidence"] = strongHits >= 2 ? "high" : strongHits === 1 ? "medium" : "low";
  const interpretation: InterpretationChip[] = [];
  if (matchedCategory) interpretation.push({ key: `cat-${matchedCategory.item.slug}`, label: pickLocalized(matchedCategory.item.name, locale), urlParam: "category" });
  if (matchedCity) interpretation.push({ key: `city-${matchedCity.item.slug}`, label: pickLocalized(matchedCity.item.name, locale), urlParam: "city" });
  if (matchedDistrict) interpretation.push({ key: `dist-${matchedDistrict.item.slug}`, label: pickLocalized(matchedDistrict.item.name, locale), urlParam: "district" });
  if (ratingIntent === "top") interpretation.push({ key: "rating-top", label: locale === "tr" ? "En iyi" : locale === "ar" ? "الأفضل" : "Top rated", urlParam: "rating" });
  if (priceLevel !== null) interpretation.push({ key: `price-${priceLevel}`, label: "$".repeat(priceLevel), urlParam: "priceLevel" });
  if (audienceIntent === "family") interpretation.push({ key: "audience-family", label: locale === "tr" ? "Aile dostu" : locale === "ar" ? "عائلي" : "Family-friendly", urlParam: "audience" });

  const structuredMatchFound = matchedCategory !== null || matchedCity !== null;
  const descriptiveIntent = structuredMatchFound;

  return {
    rawQuery: raw,
    normalizedQuery: norm,
    matchedCategorySlug: matchedCategory?.item.slug ?? null,
    matchedCitySlug: matchedCity?.item.slug ?? null,
    matchedDistrictSlug: matchedDistrict?.item.slug ?? null,
    matchedCategoryTerm: matchedCategory?.matchedText ?? null,
    matchedCityTerm: matchedCity?.matchedText ?? null,
    matchedDistrictTerm: matchedDistrict?.matchedText ?? null,
    matchedPriceTerm,
    matchedRatingTerm,
    matchedAudienceTerm,
    priceLevel,
    ratingIntent,
    audienceIntent,
    remainingKeywords: remaining,
    remainingQuery: remaining.join(" "),
    descriptiveIntent,
    confidence,
    interpretation,
  };
}

export function pickClarifyingQuestion(intent: ParsedIntent): import("@/lib/i18n").MessageKey {
  const cat = intent.matchedCategorySlug;
  if (cat === "hotels") {
    if (intent.priceLevel === null) return "search.q.hotel_budget";
    if (!intent.matchedDistrictSlug) return "search.q.hotel_district";
    return "search.q.hotel_dates";
  }
  if (cat === "restaurants" || cat === "cafes") return "search.q.restaurant_cuisine";
  if (cat === "clinics" || cat === "health" || cat === "hospitals") {
    return intent.matchedDistrictSlug ? "search.q.clinic_specialty" : "search.q.clinic_district";
  }
  return "search.q.default";
}
