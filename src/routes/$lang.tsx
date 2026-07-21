import { useEffect } from "react";
import { Outlet, createFileRoute, redirect, useRouterState } from "@tanstack/react-router";
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
import { PublicHeader } from "@/components/site/PublicHeader";
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
      const segments = location.pathname.split("/").filter(Boolean);
      segments[0] = DEFAULT_LOCALE;
      const search = location.searchStr ?? "";
      throw redirect({ to: `/${segments.join("/")}${search}` });
    }
    return { locale: params.lang as Locale };
  },
  component: LangLayout,
});

/** Paths that render their own shell (admin/owner/auth) and skip the public chrome. */
function usesOwnShell(pathname: string, lang: string): boolean {
  const rest = pathname.replace(new RegExp(`^/${lang}`), "");
  return (
    rest.startsWith("/admin") ||
    rest.startsWith("/owner") ||
    rest.startsWith("/auth") ||
    rest.startsWith("/account")
  );
}

function LangLayout() {
  const { locale } = Route.useRouteContext();
  const dir = dirFor(locale);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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

  const rest = pathname.replace(new RegExp(`^/${locale}`), "") || "/";
  const isHome = rest === "/";
  const isSearch = rest.startsWith("/search");
  const ownShell = usesOwnShell(pathname, locale);

  return (
    <LocaleContext.Provider value={value}>
      <div
        dir={dir}
        lang={locale}
        className="flex min-h-dvh flex-col bg-background text-foreground"
      >
        {!ownShell && (
          <PublicHeader
            variant={isHome ? "transparent" : "solid"}
            showCompactSearch={!isHome}
          />
        )}
        <main id="main" className={ownShell ? "flex-1" : isHome ? "flex-1" : "flex-1"}>
          <Outlet />
        </main>
        {!ownShell && !isSearch && <SiteFooter />}
      </div>
    </LocaleContext.Provider>
  );
}
