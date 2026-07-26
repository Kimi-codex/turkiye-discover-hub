import { useT, useLocale } from "@/lib/i18n";

interface SeoContentProps {
  content?: string | null;
  /** Original-language fallback when no localized content exists */
  originalContent?: string | null;
  originalLanguage?: string;
}

/**
 * Renders Phase C generated SEO content (localized descriptions, long-form
 * overview text) with locale-aware fallback to original language.
 *
 * When no content exists in the current locale nor the original language,
 * renders nothing.
 */
export function SeoContent({
  content,
  originalContent,
  originalLanguage,
}: SeoContentProps) {
  const locale = useLocale();
  const t = useT();

  const hasLocalized = typeof content === "string" && content.length > 0;
  const hasOriginal = typeof originalContent === "string" && originalContent.length > 0;

  if (!hasLocalized && !hasOriginal) return null;

  const display = hasLocalized ? content : originalContent;
  const showCredit = !hasLocalized && hasOriginal && originalLanguage && originalLanguage !== locale;

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground sm:text-base">
        {display}
      </p>
      {showCredit && (
        <p className="text-xs italic text-muted-foreground">
          {originalLanguage?.toUpperCase()}
        </p>
      )}
    </div>
  );
}
