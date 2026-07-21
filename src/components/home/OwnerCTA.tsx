import { Button } from "@/components/ui/button";
import { LocaleLink } from "@/components/site/LocaleLink";
import { useT } from "@/lib/i18n";

export function OwnerCTA() {
  const t = useT();
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-3xl bg-primary p-8 text-primary-foreground shadow-[var(--shadow-elevated)] sm:p-12">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 60% at 100% 0%, oklch(0.72 0.18 30 / 0.6), transparent 60%)",
          }}
        />
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold sm:text-3xl">
              {t("cta.owner.title")}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-primary-foreground/80 sm:text-base">
              {t("cta.owner.desc")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="bg-brand text-brand-foreground hover:bg-brand/90"
            >
              <LocaleLink to="/list-your-business">
                {t("cta.owner.add")}
              </LocaleLink>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/30 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
            >
              <LocaleLink to="/list-your-business">
                {t("cta.owner.claim")}
              </LocaleLink>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
