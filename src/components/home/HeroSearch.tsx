import { SearchBar } from "@/components/search/SearchBar";
import { useT } from "@/lib/i18n";

export function HeroSearch() {
  const t = useT();
  const popular = [
    t("nav.restaurants"),
    t("nav.hotels"),
    t("nav.clinics"),
    t("nav.cafes"),
    t("nav.attractions"),
  ];
  return (
    <section className="relative isolate overflow-hidden bg-primary text-primary-foreground">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-25"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.72 0.18 30 / 0.35), transparent 60%), radial-gradient(ellipse 60% 50% at 10% 100%, oklch(0.6 0.15 215 / 0.35), transparent 60%)",
        }}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24 lg:py-28">
        <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
          {t("hero.title")}
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-primary-foreground/80 sm:text-base md:text-lg">
          {t("hero.subtitle")}
        </p>
        <div className="mt-4 w-full max-w-3xl">
          <SearchBar variant="hero" />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-primary-foreground/80 sm:text-sm">
          <span className="opacity-70">{t("search.popular")}:</span>
          {popular.map((p) => (
            <span
              key={p}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
