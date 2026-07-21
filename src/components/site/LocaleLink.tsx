import { Link, type LinkProps } from "@tanstack/react-router";
import { forwardRef } from "react";
import { useLocale, localePath } from "@/lib/i18n";

interface LocaleLinkProps
  extends Omit<React.ComponentProps<"a">, "href" | "ref">,
    Pick<LinkProps, "preload" | "activeProps" | "inactiveProps" | "activeOptions"> {
  to: string;
  replace?: boolean;
}

/**
 * Link that preserves the active locale prefix.
 * `to` should be a locale-agnostic path (e.g. "/restaurants" or "/place/foo").
 * The final URL is `/{locale}{to}`.
 */
export const LocaleLink = forwardRef<HTMLAnchorElement, LocaleLinkProps>(
  function LocaleLink({ to, ...rest }, ref) {
    const locale = useLocale();
    const href = localePath(locale, to);
    return <Link ref={ref} to={href} {...rest} />;
  },
);
