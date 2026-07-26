import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

const autocompleteSchema = z.object({
  query: z.string().min(1).max(100),
  locale: z.string().min(2).max(5),
});

export type AutocompleteSuggestion = {
  text: string;
  type: "business" | "category" | "city";
  slug?: string;
};

const MAX_PER_TYPE = 4;
const MAX_TOTAL = 10;

/**
 * Returns matching categories, cities, and businesses for the autocomplete
 * dropdown. Uses ilike for prefix matching.
 */
export const searchAutocomplete = createServerFn({ method: "GET" })
  .validator((data: unknown) => autocompleteSchema.parse(data))
  .handler(async ({ data }) => {
    const { query, locale } = data;
    const likePattern = `${query.replace(/%/g, "")}%`;
    const suggestions: AutocompleteSuggestion[] = [];
    const seen = new Set<string>();

    const langCol = locale === "ar" ? "ar" : "en";

    // Categories via translations
    const { data: catTrans } = await supabase
      .from("category_translations")
      .select("name, language_code")
      .eq("language_code", langCol)
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
      .eq("language_code", langCol)
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
