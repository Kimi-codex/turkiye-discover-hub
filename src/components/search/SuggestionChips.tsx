import { useNavigate } from "@tanstack/react-router";
import { useLocale, useT, localePath, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const CHIP_KEYS: MessageKey[] = [
  "home.chip.hotel_sultanahmet",
  "home.chip.dental_basaksehir",
  "home.chip.family_antalya",
  "home.chip.balloon_cappadocia",
  "home.chip.car_antalya",
  "home.chip.restaurant_kadikoy",
];

interface SuggestionChipsProps {
  variant?: "onHero" | "onLight";
  showLabel?: boolean;
  className?: string;
}

export function SuggestionChips({
  variant = "onHero",
  showLabel = true,
  className,
}: SuggestionChipsProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      {showLabel && (
        <span
          className={cn(
            "text-[0.65rem] font-semibold uppercase tracking-widest",
            variant === "onHero" ? "text-foreground/60" : "text-muted-foreground",
          )}
        >
          {t("home.try")}
        </span>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {CHIP_KEYS.map((key) => {
          const label = t(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() =>
                navigate({
                  to: localePath(locale, "/search"),
                  search: { q: label },
                })
              }
              className={cn(
                "rounded-full border px-4 py-2 text-xs font-medium shadow-sm transition-colors sm:text-sm",
                "border-black/10 bg-white/95 text-foreground hover:bg-white",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
