import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { HeroSearch } from "@/components/home/HeroSearch";
import { CategoryTiles } from "@/components/home/CategoryTiles";
import { CityTiles } from "@/components/home/CityTiles";
import { BusinessSection } from "@/components/home/BusinessSection";
import { OwnerCTA } from "@/components/home/OwnerCTA";
import { buildHreflang, canonicalFor } from "@/lib/seo/hreflang";
import { translate, type Locale } from "@/lib/i18n";
import { queryOptions } from "@tanstack/react-query";

const homeQuery = () =>
  queryOptions({
    queryKey: ["home"],
    queryFn: async () => {
      const [categories, cities, featured, topRestaurants, popularHotels, clinics] =
        await Promise.all([
          services.categories.getTopLevel(),
          services.cities.getFeatured(6),
          services.businesses.getFeatured(8),
          services.businesses.getByCategory("restaurants", 8),
          services.businesses.getByCategory("hotels", 8),
          services.businesses.getByCategory("clinics", 8),
        ]);
      return { categories, cities, featured, topRestaurants, popularHotels, clinics };
    },
  });

export const Route = createFileRoute("/$lang/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery()),
  head: ({ params }) => {
    const locale = params.lang as Locale;
    const title = `${translate(locale, "brand.name")} — ${translate(locale, "brand.tagline")}`;
    const desc = translate(locale, "hero.subtitle");
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalFor(locale, "/") },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: desc },
      ],
      links: [
        { rel: "canonical", href: canonicalFor(locale, "/") },
        ...buildHreflang("/"),
      ],
    };
  },
  component: HomePage,
});

function HomePage() {
  const { data } = useSuspenseQuery(homeQuery());
  return (
    <>
      <HeroSearch />
      <CategoryTiles categories={data.categories} />
      <CityTiles cities={data.cities} />
      <BusinessSection
        titleKey="sections.featured_businesses"
        businesses={data.featured}
      />
      <BusinessSection
        titleKey="sections.top_restaurants"
        businesses={data.topRestaurants}
      />
      <BusinessSection
        titleKey="sections.popular_hotels"
        businesses={data.popularHotels}
      />
      <BusinessSection
        titleKey="sections.recommended_clinics"
        businesses={data.clinics}
      />
      <OwnerCTA />
    </>
  );
}
