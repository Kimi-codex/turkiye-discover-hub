import { useState, type FormEvent } from "react";
import { Search, ArrowRight, ArrowLeft } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useLocale, useT, isRtl, localePath } from "@/lib/i18n";

interface SmartSearchInputProps {
  size?: "hero" | "compact";
  initialValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  className?: string;
}

/**
 * Rounded pill search input. Leading search icon, trailing circular submit.
 * On submit, navigates to /{lang}/search?q=... unless a custom onSubmit is
 * provided (in which case the parent handles the navigation).
 */
export function SmartSearchInput({
  size = "hero",
  initialValue = "",
  placeholder,
  autoFocus,
  onSubmit,
  className,
}: SmartSearchInputProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [value, setValue] = useState(initialValue);
  const rtl = isRtl(locale);
  const Arrow = rtl ? ArrowLeft : ArrowRight;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (onSubmit) {
      onSubmit(trimmed);
    } else {
      navigate({
        to: localePath(locale, "/search"),
        search: { q: trimmed },
      });
    }
  }

  const hero = size === "hero";
  const submitLabel = t("search.button");

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      className={cn(
        "relative flex w-full items-center rounded-full bg-white text-foreground shadow-[0_10px_40px_-15px_rgba(15,15,40,0.25)] ring-1 ring-black/5",
        hero ? "gap-2 py-2 ps-6 pe-2" : "gap-2 py-1.5 ps-4 pe-1.5",
        className,
      )}
    >
      <Search
        className={cn("shrink-0 text-muted-foreground", hero ? "h-5 w-5" : "h-4 w-4")}
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? t("home.search_placeholder")}
        aria-label={submitLabel}
        autoFocus={autoFocus}
        autoComplete="off"
        className={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70",
          hero ? "text-base sm:text-lg" : "text-sm",
        )}
      />
      <button
        type="submit"
        aria-label={submitLabel}
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-brand text-brand-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2",
          hero ? "h-11 w-11" : "h-8 w-8",
        )}
      >
        <Arrow className={hero ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
      </button>
    </form>
  );
}
