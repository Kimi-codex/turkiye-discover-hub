import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import type { Locale } from "@/types/domain";
import { normalize } from "./parseIntent";

const didYouMeanSchema = z.object({
  query: z.string().min(1).max(160),
  locale: z.enum(["tr", "en", "ar", "fr", "ru"]),
});

const MAX_SUGGESTIONS = 3;
const MIN_CONFIDENCE = 0.45;

type Suggestion = { text: string; type: string; confidence: number };
type Candidate = { text: string | null; type: string };
type AliasRow = { alias: string; entity_type: string };

function cleanQuery(input: string): string {
  return input.replace(/[%_*]/g, "").replace(/,/g, " ").trim();
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function isAliasRow(value: unknown): value is AliasRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.alias === "string" && typeof row.entity_type === "string";
}

function editDistance(a: string, b: string): number {
  const costs = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = i - 1;
    costs[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = costs[j];
      costs[j] = Math.min(
        costs[j] + 1,
        costs[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return costs[b.length] ?? 0;
}

function confidence(query: string, suggestion: string): number {
  const q = normalize(query);
  const s = normalize(suggestion);
  if (!q || !s || q === s) return 0;
  if (s.includes(q) || q.includes(s)) {
    return Math.min(q.length, s.length) / Math.max(q.length, s.length);
  }
  const longest = Math.max(q.length, s.length);
  return longest === 0 ? 0 : 1 - editDistance(q, s) / longest;
}

async function fetchAliasSuggestions(query: string, locale: Locale): Promise<AliasRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return [];

  const url = new URL("/rest/v1/search_aliases", supabaseUrl);
  url.searchParams.set("select", "alias,entity_type");
  url.searchParams.set("alias", `ilike.*${query}*`);
  url.searchParams.set("language_code", `eq.${locale}`);
  url.searchParams.set("order", "alias.asc");
  url.searchParams.set("limit", String(MAX_SUGGESTIONS));

  const headers = new Headers({ apikey: publishableKey, Accept: "application/json" });
  if (!isNewSupabaseApiKey(publishableKey)) {
    headers.set("Authorization", `Bearer ${publishableKey}`);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) return [];

  const payload = await response.json();
  return Array.isArray(payload) ? payload.filter(isAliasRow) : [];
}

function addSuggestion(
  suggestions: Suggestion[],
  seen: Set<string>,
  query: string,
  text: string | null,
  type: string,
) {
  if (!text) return;
  const score = confidence(query, text);
  const seenKey = normalize(text);
  if (score < MIN_CONFIDENCE || seen.has(seenKey)) return;
  seen.add(seenKey);
  suggestions.push({ text, type, confidence: score });
}

export function rankDidYouMeanCandidates(query: string, candidates: Candidate[]) {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    addSuggestion(suggestions, seen, query, candidate.text, candidate.type);
  }
  return suggestions
    .sort((a, b) => b.confidence - a.confidence || a.text.localeCompare(b.text))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ text, type }) => ({ text, type }));
}

/**
 * Conservative did-you-mean suggestions from public businesses, taxonomy,
 * locations, and aliases. It never rewrites the user's query automatically.
 */
export const suggestDidYouMean = createServerFn({ method: "GET" })
  .validator((data: unknown) => didYouMeanSchema.parse(data))
  .handler(async ({ data }) => {
    const query = cleanQuery(data.query);
    if (query.length < 2) return [];

    const candidates: Candidate[] = [];
    const likePattern = `%${query}%`;

    const { data: businessNames } = await supabase
      .from("businesses")
      .select("name")
      .eq("status", "published")
      .ilike("name", likePattern)
      .limit(MAX_SUGGESTIONS);
    for (const row of businessNames ?? []) {
      candidates.push({ text: row.name, type: "business" });
    }

    const { data: bizNames } = await supabase
      .from("business_translations")
      .select("translated_name")
      .eq("language_code", data.locale)
      .ilike("translated_name", likePattern)
      .limit(MAX_SUGGESTIONS);
    for (const row of bizNames ?? []) {
      candidates.push({ text: row.translated_name, type: "business" });
    }

    const { data: catNames } = await supabase
      .from("category_translations")
      .select("name")
      .eq("language_code", data.locale)
      .ilike("name", likePattern)
      .limit(MAX_SUGGESTIONS);
    for (const row of catNames ?? []) {
      candidates.push({ text: row.name, type: "category" });
    }

    const { data: cityNames } = await supabase
      .from("city_translations")
      .select("name")
      .eq("language_code", data.locale)
      .ilike("name", likePattern)
      .limit(MAX_SUGGESTIONS);
    for (const row of cityNames ?? []) {
      candidates.push({ text: row.name, type: "city" });
    }

    const { data: districtNames } = await supabase
      .from("district_translations")
      .select("name")
      .eq("language_code", data.locale)
      .ilike("name", likePattern)
      .limit(MAX_SUGGESTIONS);
    for (const row of districtNames ?? []) {
      candidates.push({ text: row.name, type: "district" });
    }

    for (const row of await fetchAliasSuggestions(query, data.locale)) {
      candidates.push({ text: row.alias, type: "alias" });
    }

    return rankDidYouMeanCandidates(query, candidates);
  });
