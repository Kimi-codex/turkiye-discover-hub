/**
 * Lovable AI Gateway translation provider.
 *
 * Runs ONLY inside server functions or server routes. Reads LOVABLE_API_KEY
 * inside the call, never at module scope.
 *
 * Contract:
 *   - Returns the translated string EXACTLY — no wrapping, no commentary.
 *   - Preserves the original meaning; does not add facts.
 *   - Preserves inline URLs, phone numbers, and numeric tokens verbatim.
 */
import { TRANSLATION_PROMPT_VERSION } from "./hash";
import type { SupportedLocale, TranslatableField, TranslationResult } from "./provider";

const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface TranslateArgs {
  text: string;
  sourceLanguage: SupportedLocale;
  targetLanguage: SupportedLocale;
  field: TranslatableField;
  model?: string;
}

const LANG_NAME: Record<SupportedLocale, string> = {
  tr: "Turkish (tr)",
  en: "English (en)",
  ar: "Arabic (ar)",
};

function buildPrompt(args: TranslateArgs) {
  const src = LANG_NAME[args.sourceLanguage];
  const tgt = LANG_NAME[args.targetLanguage];
  const kind =
    args.field === "name"
      ? "the proper business name (keep brand tokens; do not invent a translation for brand words)"
      : "a marketing-safe business description";

  const system = [
    `You are a professional translator for a Turkey travel directory.`,
    `Translate ${kind} from ${src} to ${tgt}.`,
    `RULES:`,
    `- Output ONLY the translated text. No quotes, no notes, no explanation.`,
    `- Preserve URLs, phone numbers, email addresses, and numeric tokens verbatim.`,
    `- Do not add facts, hours, prices, or claims that are not in the source.`,
    `- Keep tone concise and professional.`,
    `- If the source is already in ${tgt}, return it unchanged.`,
    `Prompt contract: ${TRANSLATION_PROMPT_VERSION}.`,
  ].join("\n");

  return { system, user: args.text };
}

export async function translateWithLovableAI(args: TranslateArgs): Promise<TranslationResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not set");

  const model = args.model ?? DEFAULT_MODEL;
  const { system, user } = buildPrompt(args);

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });

  if (res.status === 402) {
    throw new Error("translation_provider:credits_exhausted");
  }
  if (res.status === 429) {
    throw new Error("translation_provider:rate_limited");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`translation_provider:http_${res.status}:${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const translated = raw.trim();
  if (!translated) throw new Error("translation_provider:empty_response");

  return {
    translatedText: translated,
    provider: "lovable-ai",
    model,
    usedFallback: false,
  };
}
