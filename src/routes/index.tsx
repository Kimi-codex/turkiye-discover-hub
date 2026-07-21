import { createFileRoute, redirect } from "@tanstack/react-router";
import { DEFAULT_LOCALE } from "@/lib/i18n";

/**
 * `/` always redirects to the default locale prefix.
 * The homepage lives at `/{DEFAULT_LOCALE}`.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: `/${DEFAULT_LOCALE}` });
  },
});
