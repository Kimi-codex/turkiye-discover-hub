import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ENRICHMENT_PROMPT_VERSION, computeSourceHash, pickSourceHashLabel } from "@/lib/enrichment/generation-key";
import type { Locale } from "@/types/domain";

const supportedLocaleSchema = z.enum(["tr", "en", "ar", "fr", "ru"]);

const inputSchema = z.object({
  businessId: z.string().uuid(),
  locale: supportedLocaleSchema,
});

export type PublishedBusinessSeoContent = {
  description: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
};

type GenerationRow = {
  content_type: string;
  locale: string;
  generated_content: string | null;
  generation_status: string;
  prompt_version: string;
  source_content_hash: string;
  completed_at: string | null;
};

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function isGenerationRow(value: unknown): value is GenerationRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.content_type === "string" &&
    typeof row.locale === "string" &&
    (typeof row.generated_content === "string" || row.generated_content === null) &&
    typeof row.generation_status === "string" &&
    typeof row.prompt_version === "string" &&
    typeof row.source_content_hash === "string" &&
    (typeof row.completed_at === "string" || row.completed_at === null)
  );
}

function parseSeoPayload(raw: string | null): { seoTitle: string | null; metaDescription: string | null } {
  if (!raw) return { seoTitle: null, metaDescription: null };
  try {
    const parsed = JSON.parse(raw) as { seo_title?: unknown; meta_description?: unknown };
    return {
      seoTitle: typeof parsed.seo_title === "string" && parsed.seo_title.trim() ? parsed.seo_title.trim() : null,
      metaDescription:
        typeof parsed.meta_description === "string" && parsed.meta_description.trim()
          ? parsed.meta_description.trim()
          : null,
    };
  } catch {
    return { seoTitle: null, metaDescription: null };
  }
}

async function fetchGenerationRows(params: {
  businessId: string;
  locale: Locale;
  sourceHash: string;
}): Promise<GenerationRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return [];

  const url = new URL("/rest/v1/business_content_generation", supabaseUrl);
  url.searchParams.set(
    "select",
    "content_type,locale,generated_content,generation_status,prompt_version,source_content_hash,completed_at",
  );
  url.searchParams.set("business_id", `eq.${params.businessId}`);
  url.searchParams.set("locale", `eq.${params.locale}`);
  url.searchParams.set("generation_status", "eq.completed");
  url.searchParams.set("prompt_version", `eq.${ENRICHMENT_PROMPT_VERSION}`);
  url.searchParams.set("source_content_hash", `eq.${params.sourceHash}`);
  url.searchParams.set("order", "completed_at.desc");
  url.searchParams.set("limit", "10");

  const headers = new Headers({
    apikey: serviceRoleKey,
    Accept: "application/json",
  });
  if (!isNewSupabaseApiKey(serviceRoleKey)) {
    headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) return [];

  const payload = await response.json();
  if (!Array.isArray(payload)) return [];

  return payload.filter(isGenerationRow);
}

export const getPublishedBusinessSeoContent = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<PublishedBusinessSeoContent> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select(
        `
          id, name, original_language, description, status,
          city:cities!businesses_city_id_fkey(city_translations(language_code, name)),
          primary_category:categories!businesses_primary_category_id_fkey(category_translations(language_code, name))
        `,
      )
      .eq("id", data.businessId)
      .eq("status", "published")
      .maybeSingle();

    if (businessError || !business) {
      return { description: null, seoTitle: null, metaDescription: null };
    }

    const row = business as unknown as {
      name: string | null;
      original_language: string | null;
      description: string | null;
      city?: { city_translations?: Array<{ language_code: string; name: string | null }> } | null;
      primary_category?: { category_translations?: Array<{ language_code: string; name: string | null }> } | null;
    };

    const originalLanguage = row.original_language ?? "";
    const categoryName = pickSourceHashLabel(row.primary_category?.category_translations, originalLanguage);
    const cityName = pickSourceHashLabel(row.city?.city_translations, originalLanguage);

    const currentSourceHash = computeSourceHash({
      name: row.name ?? "",
      category: categoryName,
      city: cityName,
      originalLanguage,
      existingDescription: row.description ?? "",
    });

    const rows = await fetchGenerationRows({
      businessId: data.businessId,
      locale: data.locale,
      sourceHash: currentSourceHash,
    });
    const description =
      rows.find((r) => r.content_type === "description" && r.generated_content?.trim())?.generated_content?.trim() ??
      null;
    const seo = parseSeoPayload(rows.find((r) => r.content_type === "seo")?.generated_content ?? null);

    return {
      description,
      seoTitle: seo.seoTitle,
      metaDescription: seo.metaDescription,
    };
  });
