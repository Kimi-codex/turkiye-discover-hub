import {
  Bed,
  Coffee,
  Landmark,
  Sparkles,
  Stethoscope,
  Utensils,
  ShoppingBag,
  Hospital,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "@/types/domain";
import { LocaleLink } from "@/components/site/LocaleLink";
import { pickLocalized, useLocale, useT } from "@/lib/i18n";

const ICON_MAP: Record<string, LucideIcon> = {
  utensils: Utensils,
  bed: Bed,
  stethoscope: Stethoscope,
  hospital: Hospital,
  coffee: Coffee,
  landmark: Landmark,
  sparkles: Sparkles,
  "shopping-bag": ShoppingBag,
};

interface CategoryTilesProps {
  categories: Category[];
}

export function CategoryTiles({ categories }: CategoryTilesProps) {
  const locale = useLocale();
  const t = useT();
  return (
    <section
      aria-labelledby="section-top-categories"
      className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8"
    >
      <h2 id="section-top-categories" className="text-xl font-bold sm:text-2xl">
        {t("sections.top_categories")}
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {categories.map((c) => {
          const Icon = ICON_MAP[c.icon ?? ""] ?? Utensils;
          return (
            <LocaleLink
              key={c.id}
              to={`/${c.slug}`}
              className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {pickLocalized(c.name, locale)}
                </div>
                {typeof c.businessCount === "number" && (
                  <div className="text-xs text-muted-foreground">
                    {c.businessCount.toLocaleString()}
                  </div>
                )}
              </div>
            </LocaleLink>
          );
        })}
      </div>
    </section>
  );
}
