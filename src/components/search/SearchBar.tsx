import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, useT, localePath } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  initialQuery?: string;
  initialLocation?: string;
  variant?: "hero" | "compact";
  className?: string;
}

export function SearchBar({
  initialQuery = "",
  initialLocation = "",
  variant = "hero",
  className,
}: SearchBarProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [q, setQ] = useState(initialQuery);
  const [loc, setLoc] = useState(initialLocation);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (loc.trim()) params.set("city", loc.trim().toLowerCase());
    const search = params.toString();
    navigate({ to: `${localePath(locale, "/search")}${search ? `?${search}` : ""}` });
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "w-full rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-elevated)]",
        variant === "hero" ? "sm:rounded-full" : "",
        className,
      )}
      role="search"
      aria-label={t("search.button")}
    >
      <div
        className={cn(
          "grid gap-2",
          variant === "hero"
            ? "sm:grid-cols-[minmax(0,1fr)_1px_minmax(0,14rem)_auto]"
            : "sm:grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        <label className="relative flex min-w-0 items-center gap-2 rounded-xl px-4 py-2 sm:rounded-full">
          <Search
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">{t("search.placeholder")}</span>
          <input
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search.placeholder")}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        {variant === "hero" && (
          <div
            aria-hidden="true"
            className="hidden self-stretch bg-border sm:block"
          />
        )}
        {variant === "hero" && (
          <label className="relative flex min-w-0 items-center gap-2 rounded-xl px-4 py-2 sm:rounded-full">
            <MapPin
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">{t("search.location_placeholder")}</span>
            <input
              type="text"
              name="city"
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
              placeholder={t("search.location_placeholder")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        )}
        <Button
          type="submit"
          size={variant === "hero" ? "lg" : "default"}
          className={cn(
            "shrink-0 gap-2 bg-brand text-brand-foreground hover:bg-brand/90",
            variant === "hero" && "sm:rounded-full sm:px-6",
          )}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span>{t("search.button")}</span>
        </Button>
      </div>
    </form>
  );
}
