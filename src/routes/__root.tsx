import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, dirFor } from "@/lib/i18n";
import { AuthProvider } from "@/hooks/use-auth";

function NotFoundComponent() {
  return (
    <html lang={DEFAULT_LOCALE} dir={dirFor(DEFAULT_LOCALE)}>
      <head>
        <HeadContent />
      </head>
      <body>
        <main className="flex min-h-dvh items-center justify-center bg-background px-4">
          <div className="max-w-md text-center">
            <h1 className="text-7xl font-bold text-foreground">404</h1>
            <h2 className="mt-4 text-xl font-semibold text-foreground">
              Sayfa bulunamadı
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Aradığınız sayfa taşınmış veya kaldırılmış olabilir.
            </p>
            <div className="mt-6">
              <a
                href="/tr"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Ana sayfaya dön
              </a>
            </div>
          </div>
        </main>
        <Scripts />
      </body>
    </html>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Bir şeyler ters gitti
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sayfayı yeniden yüklemeyi deneyin.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Tekrar dene
          </Button>
          <a
            href="/tr"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ana sayfa
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title:
          "Keşfet Türkiye — Türkiye'nin premium yerel keşif rehberi",
      },
      {
        name: "description",
        content:
          "Türkiye'deki restoranları, otelleri, klinikleri ve turistik yerleri keşfedin. Doğrulanmış işletmeler tek bir yerde.",
      },
      { property: "og:site_name", content: "Keşfet Türkiye" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#1f2340" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
      },
      {
        rel: "preconnect",
        href: "https://images.unsplash.com",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} dir={dirFor(DEFAULT_LOCALE)} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    // Keep router + query cache in sync with Supabase auth events (once, at root).
    let unsub: (() => void) | undefined;
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
          router.invalidate();
          if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
        }
      });
      unsub = () => data.subscription.unsubscribe();
    })();
    return () => {
      unsub?.();
    };
  }, [queryClient, router]);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}
