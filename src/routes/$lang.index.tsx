import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { services } from "@/lib/repos";
import { Hero } from "@/components/home/Hero";
import { CategoryShortcuts } from "@/components/home/CategoryShortcuts";
import { buildHreflang, canonicalFor, ogLocaleFor } from "@/lib/seo/hreflang";
import { translate, type Locale } from "@/lib/i18n";

const homeQuery = () =>
  queryOptions({
    queryKey: ["home", "shortcuts"],
    queryFn: async () => {
      const categories = await services.categories.getTopLevel();
      return { categories };
    },
  });

export const Route = createFileRoute("/$lang/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery()),
  head: ({ params }) => {
    const locale = params.lang as Locale;
    const title = `${translate(locale, "home.badge")} — ${translate(locale, "home.title")}`;
    const desc = translate(locale, "home.subtitle");
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalFor(locale, "/") },
        { property: "og:locale", content: ogLocaleFor(locale) },
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
      <Hero />
      <CategoryShortcuts categories={data.categories} />
    </>
  );
}
