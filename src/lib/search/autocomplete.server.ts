import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import type { Locale } from "@/types/domain";

const autocompleteSchema = z.object({
  query: z.string().min(1).max(100),
  locale: z.enum(["tr", "en", "ar", "fr", "ru"]),
});

export type AutocompleteSuggestion = {
  text: string;
  type: "business" | "category" | "city" | "district" | "alias";
  slug?: string;
};

const MAX_PER_TYPE = 4;
const MAX_TOTAL = 10;

type AliasRow = {
  alias: string;
  entity_type: string;
};

function cleanPrefix(input: string): string {
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

async function fetchAliasSuggestions(query: string, locale: Locale): Promise<AliasRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return [];

  const url = new URL("/rest/v1/search_aliases", supabaseUrl);
  url.searchParams.set("select", "alias,entity_type");
  url.searchParams.set("alias", `ilike.${query}*`);
  url.searchParams.set("language_code", `eq.${locale}`);
  url.searchParams.set("order", "alias.asc");
  url.searchParams.set("limit", String(MAX_PER_TYPE));

  const headers = new Headers({ apikey: publishableKey, Accept: "application/json" });
  if (!isNewSupabaseApiKey(publishableKey)) {
    headers.set("Authorization", `Bearer ${publishableKey}`);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) return [];

  const payload = await response.json();
  return Array.isArray(payload) ? payload.filter(isAliasRow) : [];
}

/**
 * Returns matching categories, cities, and businesses for the autocomplete
 * dropdown. Uses ilike for prefix matching.
 */
export const searchAutocomplete = createServerFn({ method: "GET" })
  .validator((data: unknown) => autocompleteSchema.parse(data))
  .handler(async ({ data }) => {
    const { query, locale } = data;
    const cleaned = cleanPrefix(query);
    if (cleaned.length < 2) return [];
    const likePattern = `${cleaned}%`;
    const suggestions: AutocompleteSuggestion[] = [];
    const seen = new Set<string>();

    // Categories via translations
    const { data: catTrans } = await supabase
      .from("category_translations")
      .select("name, language_code")
      .eq("language_code", locale)
      .ilike("name", likePattern)
      .limit(MAX_PER_TYPE);

    if (catTrans) {
      for (const row of catTrans) {
        if (row.name && !seen.has(row.name)) {
          seen.add(row.name);
          suggestions.push({ text: row.name, type: "category" });
        }
      }
    }

    // Cities via translations
    const { data: cityTrans } = await supabase
      .from("city_translations")
      .select("name, language_code")
      .eq("language_code", locale)
      .ilike("name", likePattern)
      .limit(MAX_PER_TYPE);

    if (cityTrans) {
      for (const row of cityTrans) {
        if (row.name && !seen.has(row.name)) {
          seen.add(row.name);
          suggestions.push({ text: row.name, type: "city" });
        }
      }
    }

    // Districts via translations
    const { data: districtTrans } = await supabase
      .from("district_translations")
      .select("name, language_code")
      .eq("language_code", locale)
      .ilike("name", likePattern)
      .limit(MAX_PER_TYPE);

    if (districtTrans) {
      for (const row of districtTrans) {
        if (row.name && !seen.has(row.name)) {
          seen.add(row.name);
          suggestions.push({ text: row.name, type: "district" });
        }
      }
    }

    const aliasRows = await fetchAliasSuggestions(cleaned, locale);
    for (const row of aliasRows) {
      if (row.alias && !seen.has(row.alias)) {
        seen.add(row.alias);
        suggestions.push({ text: row.alias, type: "alias" });
      }
    }

    if (suggestions.length >= MAX_TOTAL) {
      return suggestions.slice(0, MAX_TOTAL);
    }

    // Businesses (name is directly in the table)
    const { data: bizRows } = await supabase
      .from("businesses")
      .select("slug, name")
      .eq("status", "published")
      .ilike("name", likePattern)
      .limit(MAX_PER_TYPE);

    if (bizRows) {
      for (const row of bizRows) {
        if (row.name && !seen.has(row.name + row.slug)) {
          seen.add(row.name + row.slug);
          suggestions.push({ text: row.name, type: "business", slug: row.slug });
        }
      }
    }

    return suggestions.slice(0, MAX_TOTAL);
  });
