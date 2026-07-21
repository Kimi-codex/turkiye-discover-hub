import { MapPin } from "lucide-react";
import { LocaleLink } from "./LocaleLink";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useT } from "@/lib/i18n";
import { CATEGORIES, CITIES } from "@/lib/repos/demo-data";
import { pickLocalized } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n";

export function SiteFooter() {
  const t = useT();
  const locale = useLocale();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-border bg-surface-muted">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-5 lg:px-8">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold">{t("brand.name")}</span>
          </div>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            {t("brand.tagline")}
          </p>
          <div className="mt-5">
            <LanguageSwitcher variant="inline" />
          </div>
        </div>

        <FooterColumn title={t("footer.categories")}>
          {CATEGORIES.slice(0, 6).map((c) => (
            <FooterLink key={c.id} to={`/${c.slug}`}>
              {pickLocalized(c.name, locale)}
            </FooterLink>
          ))}
        </FooterColumn>

        <FooterColumn title={t("footer.cities")}>
          {CITIES.slice(0, 6).map((c) => (
            <FooterLink key={c.id} to={`/${c.slug}`}>
              {pickLocalized(c.name, locale)}
            </FooterLink>
          ))}
        </FooterColumn>

        <FooterColumn title={t("footer.company")}>
          <FooterLink to="/about">{t("footer.about")}</FooterLink>
          <FooterLink to="/help">{t("footer.help")}</FooterLink>
          <FooterLink to="/list-your-business">{t("footer.owners")}</FooterLink>
          <FooterLink to="/privacy">{t("footer.privacy")}</FooterLink>
          <FooterLink to="/terms">{t("footer.terms")}</FooterLink>
        </FooterColumn>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 text-center text-xs text-muted-foreground sm:px-6 lg:px-8">
          {t("footer.copyright", { year })}
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li>
      <LocaleLink
        to={to}
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {children}
      </LocaleLink>
    </li>
  );
}
