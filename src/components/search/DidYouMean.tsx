import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useLocale, useT } from "@/lib/i18n";
import { useServerFn } from "@tanstack/react-start";
import { suggestDidYouMean } from "@/lib/search/did-you-mean.server";

interface DidYouMeanProps {
  query: string;
  resultCount: number;
  className?: string;
}

export function DidYouMean({ query, resultCount, className }: DidYouMeanProps) {
  const locale = useLocale();
  const t = useT();
  const navigate = useNavigate();
  const getSuggestions = useServerFn(suggestDidYouMean);

  const { data: suggestions } = useQuery({
    queryKey: ["did-you-mean", query, locale],
    queryFn: () => getSuggestions({ data: { query, locale } }),
    enabled: resultCount < 3 && query.trim().length >= 2,
    staleTime: 60_000,
  });

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-sm text-muted-foreground">
        Did you mean:{' '}
        {suggestions.map((s, i) => (
          <span key={s.text}>
            {i > 0 && ", "}
            <button
              type="button"
              onClick={() => {
                navigate({
                  to: "/$lang/search",
                  params: { lang: locale },
                  search: {
                    q: s.text,
                    category: null,
                    city: null,
                    district: null,
                    rating: null,
                    priceLevel: null,
                    audience: null,
                    intent: null,
                    clarify: null,
                    sort: "recommended",
                    page: 1,
                    view: "list",
                  },
                });
              }}
              className="font-medium text-brand hover:underline"
            >
              {s.text}
            </button>
          </span>
        ))}
      </p>
    </div>
  );
}
