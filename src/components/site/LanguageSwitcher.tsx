import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Check, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOCALES,
  useLocale,
  useT,
  withLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  variant?: "header" | "inline";
  className?: string;
}

export function LanguageSwitcher({
  variant = "header",
  className,
}: LanguageSwitcherProps) {
  const t = useT();
  const current = useLocale();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  function pathFor(next: Locale) {
    return withLocale(pathname, next);
  }

  function handleSelect(next: Locale) {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    }
    navigate({ to: pathFor(next) });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "header" ? "ghost" : "outline"}
          size="sm"
          className={cn(
            "gap-2",
            variant === "header" &&
              "text-primary-foreground hover:bg-white/10 hover:text-primary-foreground",
            className,
          )}
          aria-label={t("footer.language")}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          <span className="hidden text-sm font-medium uppercase sm:inline">
            {current}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {LOCALES.map((loc) => (
          <DropdownMenuItem key={loc} asChild>
            <Link
              to={pathFor(loc)}
              hrefLang={loc}
              onClick={() => handleSelect(loc)}
              className="flex cursor-pointer items-center justify-between"
            >
              <span>{t(`lang.${loc}` as const)}</span>
              {loc === current && (
                <Check className="h-4 w-4 text-brand" aria-hidden="true" />
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
