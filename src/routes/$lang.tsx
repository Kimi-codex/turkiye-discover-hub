import { useEffect } from "react";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  DEFAULT_LOCALE,
  LocaleContext,
  dirFor,
  isLocale,
  pickLocalized,
  translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

/**
 * The `_lang` layout: validates the locale, sets html dir/lang, and provides
 * the LocaleContext to every child route.
 *
 * Invalid locales redirect to the Turkish equivalent of the same path.
 */
export const Route = createFileRoute("/$lang")({
  beforeLoad: ({ params, location }) => {
    if (!isLocale(params.lang)) {
      // Rebuild the URL with the default (Turkish) locale in place of the invalid segment.
      const segments = location.pathname.split("/").filter(Boolean);
      segments[0] = DEFAULT_LOCALE;
      const search = location.searchStr ?? "";
      throw redirect({ to: `/${segments.join("/")}${search}` });
    }
    return { locale: params.lang as Locale };
  },
  component: LangLayout,
});

function LangLayout() {
  const { locale } = Route.useRouteContext();
  const dir = dirFor(locale);

  // Sync <html> lang + dir on the client after hydration.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const value = {
    locale,
    dir,
    t: (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    pick: (v: Parameters<typeof pickLocalized>[0]) => pickLocalized(v, locale),
  };

  return (
    <LocaleContext.Provider value={value}>
      <div
        dir={dir}
        lang={locale}
        className="flex min-h-dvh flex-col bg-background text-foreground"
      >
        <SiteHeader />
        <main id="main" className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </LocaleContext.Provider>
  );
}
