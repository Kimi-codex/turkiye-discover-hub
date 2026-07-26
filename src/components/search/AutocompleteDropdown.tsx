import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Search, MapPin, Tag, Building2, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import { useLocale, isRtl } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { searchAutocomplete, type AutocompleteSuggestion } from "@/lib/search/autocomplete.server";
import { useServerFn } from "@tanstack/react-start";

interface AutocompleteDropdownProps {
  inputValue: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  size?: "hero" | "compact";
}

const ICONS: Record<string, typeof Search> = {
  category: Tag,
  city: MapPin,
  district: MapPin,
  business: Building2,
  alias: Sparkles,
};

const LABELS: Record<string, string> = {
  category: "Category",
  city: "City",
  district: "District",
  business: "Business",
  alias: "Suggestion",
};

export function AutocompleteDropdown({
  inputValue,
  onValueChange,
  onSubmit,
  placeholder,
  autoFocus,
  className,
  size = "hero",
}: AutocompleteDropdownProps) {
  const locale = useLocale();
  const rtl = isRtl(locale);
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  const navigate = useNavigate();
  const getAutocomplete = useServerFn(searchAutocomplete);

  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRef = useRef(activeIndex);
  activeRef.current = activeIndex;

  const triggerSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }
      setIsLoading(true);
      try {
        const result = await getAutocomplete({ data: { query: trimmed, locale } });
        setSuggestions(result);
        setIsOpen(result.length > 0);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    },
    [locale, getAutocomplete],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      triggerSearch(inputValue);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, triggerSearch]);

  function close() {
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function select(suggestion: AutocompleteSuggestion) {
    close();
    if (suggestion.type === "business" && suggestion.slug) {
      navigate({
        to: "/$lang/place/$slug",
        params: { lang: locale, slug: suggestion.slug },
      });
    } else {
      navigate({
        to: "/$lang/search",
        params: { lang: locale },
        search: {
          q: suggestion.text,
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
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (activeIndex >= 0 && activeIndex < suggestions.length) {
      select(suggestions[activeIndex]);
      return;
    }
    close();
    onSubmit(inputValue.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  }

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const hero = size === "hero";

  return (
    <div className={cn("relative", className)}>
      <form onSubmit={handleSubmit} role="search">
        <div
          className={cn(
            "relative flex w-full items-center rounded-full bg-white text-foreground shadow-[0_10px_40px_-15px_rgba(15,15,40,0.25)] ring-1 ring-black/5",
            hero ? "gap-2 py-2 ps-6 pe-2" : "gap-2 py-1.5 ps-4 pe-1.5",
          )}
        >
          <Search
            className={cn("shrink-0 text-muted-foreground", hero ? "h-5 w-5" : "h-4 w-4")}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={inputValue}
            onChange={(e) => onValueChange(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setIsOpen(true);
            }}
            onBlur={() => {
              setTimeout(close, 200);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="Search"
            autoFocus={autoFocus}
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-controls="search-suggestions"
            autoComplete="off"
            className={cn(
              "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70",
              hero ? "text-base sm:text-lg" : "text-sm",
            )}
          />
          <button
            type="submit"
            aria-label="Search"
            className={cn(
              "grid shrink-0 place-items-center rounded-full bg-brand text-brand-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2",
              hero ? "h-11 w-11" : "h-8 w-8",
            )}
          >
            <Arrow className={hero ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
          </button>
        </div>
      </form>

      {isOpen && (
        <ul
          ref={listRef}
          id="search-suggestions"
          role="listbox"
          className={cn(
            "absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-xl",
            hero ? "top-full" : "top-full",
          )}
        >
          {isLoading && (
            <li className="px-4 py-3 text-center text-xs text-muted-foreground">
              Loading...
            </li>
          )}
          {!isLoading &&
            suggestions.map((s, i) => {
              const Icon = ICONS[s.type] ?? Search;
              return (
                <li
                  key={`${s.type}-${s.text}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(s);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors",
                    i === activeIndex ? "bg-brand/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{s.text}</span>
                  <span className="shrink-0 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground/60">
                    {LABELS[s.type] ?? s.type}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
