import { SmartSearchInput } from "@/components/search/SmartSearchInput";
import { SuggestionChips } from "@/components/search/SuggestionChips";
import { useT } from "@/lib/i18n";
import heroImg from "@/assets/hero-istanbul.jpg";

export function Hero() {
  const t = useT();
  return (
    <section
      className="relative isolate flex min-h-[calc(100dvh-4rem)] w-full items-center justify-center overflow-hidden"
      aria-labelledby="hero-title"
    >
      <img
        src={heroImg}
        alt=""
        aria-hidden="true"
        width={1920}
        height={1080}
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        fetchPriority="high"
      />
      {/* Warm cream fade to blend hero into the page below */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-background/10 via-background/40 to-background"
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft/95 px-3 py-1 text-xs font-semibold text-brand shadow-sm ring-1 ring-brand/20">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-brand"
          />
          {t("home.badge")}
        </span>

        <h1
          id="hero-title"
          className="text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight text-primary sm:text-5xl md:text-6xl"
          style={{ fontFamily: "'Instrument Serif', 'Playfair Display', Georgia, serif" }}
        >
          {t("home.title")}
        </h1>
        <p className="max-w-xl text-pretty text-sm text-foreground/70 sm:text-base">
          {t("home.subtitle")}
        </p>

        <div className="mt-2 w-full">
          <SmartSearchInput size="hero" />
        </div>

        <SuggestionChips variant="onHero" className="mt-2" />
      </div>
    </section>
  );
}
