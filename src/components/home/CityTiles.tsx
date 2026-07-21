import type { City } from "@/types/domain";
import { LocaleLink } from "@/components/site/LocaleLink";
import { pickLocalized, useLocale, useT } from "@/lib/i18n";

interface CityTilesProps {
  cities: City[];
}

export function CityTiles({ cities }: CityTilesProps) {
  const locale = useLocale();
  const t = useT();
  return (
    <section
      aria-labelledby="section-featured-cities"
      className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <h2 id="section-featured-cities" className="text-xl font-bold sm:text-2xl">
        {t("sections.featured_cities")}
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {cities.map((c) => (
          <LocaleLink
            key={c.id}
            to={`/${c.slug}`}
            className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-border shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-elevated)]"
          >
            <img
              src={c.imageUrl ?? ""}
              alt={pickLocalized(c.name, locale)}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-primary/85 via-primary/25 to-transparent"
            />
            <div className="absolute inset-x-0 bottom-0 p-4 text-primary-foreground">
              <div className="text-base font-semibold">
                {pickLocalized(c.name, locale)}
              </div>
              {typeof c.businessCount === "number" && (
                <div className="text-xs opacity-85">
                  {c.businessCount.toLocaleString()}
                </div>
              )}
            </div>
          </LocaleLink>
        ))}
      </div>
    </section>
  );
}
