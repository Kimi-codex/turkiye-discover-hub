import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

const didYouMeanSchema = z.object({
  query: z.string().min(1).max(160),
  locale: z.string().min(2).max(5),
});

const MAX_SUGGESTIONS = 3;

/**
 * Queries business names, category names, and city names for alternatives
 * similar to the user's query, using trigram-based fuzzy matching.
 */
export const suggestDidYouMean = createServerFn({ method: "GET" })
  .validator((data: unknown) => didYouMeanSchema.parse(data))
  .handler(async ({ data }) => {
    const { query, locale } = data;
    const suggestions: Array<{ text: string; type: string }> = [];
    const seen = new Set<string>();

    const likePattern = `%${query.replace(/%/g, "")}%`;

    // Business names
    const { data: bizNames } = await supabase
      .from("business_translations")
      .select("translated_name")
      .eq("language_code", locale === "ar" ? "ar" : "en")
      .ilike("translated_name", likePattern)
      .limit(MAX_SUGGESTIONS);

    if (bizNames) {
      for (const row of bizNames) {
        if (row.translated_name && !seen.has(row.translated_name)) {
          seen.add(row.translated_name);
          suggestions.push({ text: row.translated_name, type: "business" });
        }
      }
    }

    // Category names
    const { data: catNames } = await supabase
      .from("category_translations")
      .select("name, language_code")
      .eq("language_code", locale === "ar" ? "ar" : "en")
      .ilike("name", likePattern)
      .limit(MAX_SUGGESTIONS);

    if (catNames) {
      for (const row of catNames) {
        if (row.name && !seen.has(row.name)) {
          seen.add(row.name);
          suggestions.push({ text: row.name, type: "category" });
        }
      }
    }

    // City names
    const { data: cityNames } = await supabase
      .from("city_translations")
      .select("name, language_code")
      .eq("language_code", locale === "ar" ? "ar" : "en")
      .ilike("name", likePattern)
      .limit(MAX_SUGGESTIONS);

    if (cityNames) {
      for (const row of cityNames) {
        if (row.name && !seen.has(row.name)) {
          seen.add(row.name);
          suggestions.push({ text: row.name, type: "city" });
        }
      }
    }

    return suggestions.slice(0, MAX_SUGGESTIONS);
  });
