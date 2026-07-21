import { Heart, MapPin, Menu, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { LocaleLink } from "./LocaleLink";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", key: "nav.home" as const },
  { to: "/restaurants", key: "nav.restaurants" as const },
  { to: "/hotels", key: "nav.hotels" as const },
  { to: "/clinics", key: "nav.clinics" as const },
  { to: "/cafes", key: "nav.cafes" as const },
];

export function SiteHeader() {
  const t = useT();

  return (
    <header className="sticky top-0 z-40 bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-20 lg:gap-6 lg:px-8">
        {/* Mobile menu */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground lg:hidden"
              aria-label={t("nav.menu")}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 max-w-[85vw]">
            <SheetHeader>
              <SheetTitle>{t("brand.name")}</SheetTitle>
            </SheetHeader>
            <nav aria-label={t("nav.menu")} className="mt-6 flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <LocaleLink
                  key={item.to}
                  to={item.to}
                  className="rounded-lg px-3 py-2.5 text-base font-medium text-foreground hover:bg-accent"
                >
                  {t(item.key)}
                </LocaleLink>
              ))}
              <LocaleLink
                to="/search"
                className="rounded-lg px-3 py-2.5 text-base font-medium text-foreground hover:bg-accent"
              >
                {t("breadcrumb.search")}
              </LocaleLink>
              <div className="my-3 h-px bg-border" />
              <LocaleLink
                to="/favorites"
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-base font-medium text-foreground hover:bg-accent"
              >
                <Heart className="h-4 w-4" aria-hidden="true" />
                {t("nav.favorites")}
              </LocaleLink>
              <LocaleLink
                to="/signin"
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-base font-medium text-foreground hover:bg-accent"
              >
                <User className="h-4 w-4" aria-hidden="true" />
                {t("nav.signin")}
              </LocaleLink>
              <LocaleLink
                to="/list-your-business"
                className="mt-3 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand/90"
              >
                {t("nav.list_business")}
              </LocaleLink>
            </nav>
          </SheetContent>
        </Sheet>

        {/* Brand */}
        <LocaleLink
          to="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground shadow-sm">
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </div>
          <span className="text-lg font-bold tracking-tight sm:text-xl">
            {t("brand.name")}
          </span>
        </LocaleLink>

        {/* Desktop nav */}
        <nav
          aria-label="Primary"
          className="ms-6 hidden items-center gap-1 lg:flex"
        >
          {NAV_ITEMS.map((item) => (
            <LocaleLink
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium text-primary-foreground/90 transition-colors hover:bg-white/10 hover:text-primary-foreground",
              )}
              activeProps={{ className: "bg-white/10 text-primary-foreground" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {t(item.key)}
            </LocaleLink>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          <LocaleLink
            to="/search"
            className="grid h-10 w-10 place-items-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/10 hover:text-primary-foreground"
            aria-label={t("breadcrumb.search")}
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </LocaleLink>
          <LanguageSwitcher />
          <LocaleLink
            to="/favorites"
            className="hidden h-10 w-10 place-items-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/10 hover:text-primary-foreground sm:grid"
            aria-label={t("nav.favorites")}
          >
            <Heart className="h-5 w-5" aria-hidden="true" />
          </LocaleLink>
          <LocaleLink
            to="/signin"
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary-foreground/90 transition-colors hover:bg-white/10 hover:text-primary-foreground sm:inline-flex"
          >
            <User className="h-4 w-4" aria-hidden="true" />
            <span>{t("nav.signin")}</span>
          </LocaleLink>
          <LocaleLink
            to="/list-your-business"
            className="hidden items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand/90 lg:inline-flex"
          >
            {t("nav.list_business")}
          </LocaleLink>
        </div>
      </div>
    </header>
  );
}
