import { z } from "zod";
import { translateWithLovableAI } from "@/lib/translations/lovable-provider.server";
import { SUPPORTED_LOCALES } from "@/lib/translations/provider";
import type { SupportedLocale } from "@/lib/translations/provider";
import { ENRICHMENT_PROMPT_VERSION } from "./generation-key";

export { SUPPORTED_LOCALES, ENRICHMENT_PROMPT_VERSION };
export type { SupportedLocale };

// ---------- Error classification ----------

export type AiErrorType = "transient" | "permanent";

export function classifyEnrichmentError(err: Error): AiErrorType {
  const m = err.message.toLowerCase();
  if (
    m.includes("network") ||
    m.includes("econnrefused") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("enotfound") ||
    m.includes("fetch failed") ||
    m.includes("abort")
  )
    return "transient";
  if (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many requests")
  )
    return "transient";
  if (m.includes("502") || m.includes("503") || m.includes("504")) return "transient";
  if (m.includes("credits_exhausted") || m.includes("402")) return "permanent";
  if (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("auth") ||
    m.includes("unauthorized") ||
    m.includes("invalid_request") ||
    m.includes("schema") ||
    m.includes("validation")
  )
    return "permanent";
  return "permanent";
}

export function getBackoffDelay(attempt: number): number {
  const base = 1000;
  const cap = 30000;
  return Math.round(Math.min(base * Math.pow(2, attempt) + Math.random() * base, cap));
}

// ---------- Zod schemas ----------

const descriptionSchema = z
  .object({
    description: z.string().min(1, "Description must not be empty").max(1000, "Description too long"),
  })
  .strict();

const seoSchema = z
  .object({
    seo_title: z
      .string()
      .min(1, "SEO title must not be empty")
      .max(60, "SEO title must be at most 60 characters"),
    meta_description: z
      .string()
      .min(1, "Meta description must not be empty")
      .max(160, "Meta description must be at most 160 characters"),
  })
  .strict();

export type DescriptionOutput = z.infer<typeof descriptionSchema>;
export type SeoOutput = z.infer<typeof seoSchema>;

// ---------- Hallucination guard ----------

const HALLUCINATION_PATTERNS = [
  /\+\d[\d\s\-()]{7,}/, // phone numbers
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // email
  /https?:\/\/[^\s]+/, // URLs
  /\b(?:₺|TL|USD|EUR|GBP|TRY)\s*\d+/, // prices with currency symbols
  /\bprice[s]?\b/i,
  /\bfee[s]?\b/i,
  /\bcost[s]?\b/i,
  /\b(?:open|close|hour)\s*(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
  /\baward[s]?\b/i,
  /\bcertification[s]?\b/i,
  /\branking[s]?\b/i,
  /\bguarantee[s]?\b/i,
  /\b(?:doctor|medical|treatment|clinic|hospital|surgery)\b/i,
  /\b(?:best|top|#1|number one|leading)\b/i,
];

export function checkHallucinations(text: string): string[] {
  const warnings: string[] = [];
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(`Possible hallucination matched: ${pattern}`);
    }
  }
  return warnings;
}

// ---------- Business data ----------

export interface BusinessData {
  name: string;
  category: string;
  city: string;
  originalLanguage: string;
  existingDescription: string;
}

const LANG_NAME: Record<SupportedLocale, string> = {
  tr: "Turkish",
  en: "English",
  ar: "Arabic",
};

function describeSource(business: BusinessData): string {
  const parts = [`Business: ${business.name}`];
  if (business.category) parts.push(`Category: ${business.category}`);
  if (business.city) parts.push(`City: ${business.city}`);
  return parts.join("\n");
}

// ---------- Generation ----------

export async function generateAIDescription(
  business: BusinessData,
  targetLanguage: string,
): Promise<DescriptionOutput> {
  const locale = SUPPORTED_LOCALES.includes(targetLanguage as SupportedLocale)
    ? (targetLanguage as SupportedLocale)
    : "en";
  const langLabel = LANG_NAME[locale];

  const system = [
    `You are a professional travel writer for a Turkey tourism directory.`,
    `Generate a concise, inviting business description in ${langLabel}.`,
    ``,
    `RULES:`,
    `- Output ONLY valid JSON: {"description": "<text>"}. No other text.`,
    `- 50-100 words in ${langLabel}.`,
    `- Use ONLY the provided business data (name, category, city).`,
    `- DO NOT invent: services, prices, awards, certifications, opening hours,`,
    `  contact information, medical claims, rankings, or guarantees.`,
    `- Focus on what makes this place worth visiting.`,
    `- Keep tone warm and professional.`,
    `- If the business name is already in ${langLabel}, keep it as-is.`,
  ].join("\n");

  const user = describeSource(business);

  const result = await translateWithLovableAI({
    text: user,
    sourceLanguage: "en",
    targetLanguage: locale,
    field: "description",
  });

  const parsed: unknown = JSON.parse(result.translatedText);
  const validated = descriptionSchema.parse(parsed);

  const warnings = checkHallucinations(validated.description);
  if (warnings.length > 0) {
    throw new Error(`Hallucination detected: ${warnings.join("; ")}`);
  }

  return validated;
}

export async function generateSeoContent(
  business: BusinessData,
  targetLanguage: string,
): Promise<SeoOutput> {
  const locale = SUPPORTED_LOCALES.includes(targetLanguage as SupportedLocale)
    ? (targetLanguage as SupportedLocale)
    : "en";
  const langLabel = LANG_NAME[locale];

  const system = [
    `You are an SEO specialist for a Turkey travel directory.`,
    `Generate SEO metadata in ${langLabel} for this business entry.`,
    ``,
    `RULES:`,
    `- Output ONLY valid JSON: {"seo_title": "<title>", "meta_description": "<desc>"}. No other text.`,
    `- SEO title: max 60 characters, include business name and main keywords.`,
    `- Meta description: max 160 characters, include business name and main keywords.`,
    `- Use ONLY the provided business data.`,
    `- DO NOT invent any information.`,
  ].join("\n");

  const user = describeSource(business);

  const result = await translateWithLovableAI({
    text: user,
    sourceLanguage: "en",
    targetLanguage: locale,
    field: "description",
  });

  const parsed: unknown = JSON.parse(result.translatedText);
  const validated = seoSchema.parse(parsed);

  return validated;
}

export type ContentGenerationRecord = {
  businessId: string;
  businessName: string;
  categoryName: string;
  cityName: string;
  originalLanguage: string;
  existingDescription: string;
};
