import {
  Bed,
  Coffee,
  Hospital,
  Landmark,
  Sparkles,
  Utensils,
  Car,
  ShoppingBag,
  Wrench,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "@/types/domain";
import { LocaleLink } from "@/components/site/LocaleLink";
import { pickLocalized, useLocale } from "@/lib/i18n";

const ICON_MAP: Record<string, LucideIcon> = {
  hotels: Bed,
  restaurants: Utensils,
  clinics: Stethoscope,
  health: Stethoscope,
  hospitals: Hospital,
  cafes: Coffee,
  attractions: Landmark,
  tours: Landmark,
  beauty: Sparkles,
  spa: Sparkles,
  "car-rental": Car,
  car_rental: Car,
  shopping: ShoppingBag,
  services: Wrench,
};

function iconFor(slug: string): LucideIcon {
  return ICON_MAP[slug] ?? Sparkles;
}

interface CategoryShortcutsProps {
  categories: Category[];
}

export function CategoryShortcuts({ categories }: CategoryShortcutsProps) {
  const locale = useLocale();
  const items = categories.slice(0, 8);
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Categories"
      className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6"
    >
      <div className="flex flex-wrap justify-center gap-2">
        {items.map((c) => {
          const Icon = iconFor(c.slug);
          return (
            <LocaleLink
              key={c.id}
              to={`/search?category=${encodeURIComponent(c.slug)}`}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-brand/30 hover:bg-white"
            >
              <Icon className="h-4 w-4 text-brand" aria-hidden="true" />
              <span>{pickLocalized(c.name, locale)}</span>
            </LocaleLink>
          );
        })}
      </div>
    </section>
  );
}
