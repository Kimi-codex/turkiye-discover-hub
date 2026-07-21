import { ChevronRight } from "lucide-react";
import { LocaleLink } from "@/components/site/LocaleLink";
import { useLocale } from "@/lib/i18n";
import { isRtl } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const locale = useLocale();
  const rtl = isRtl(locale);
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="inline-flex min-w-0 items-center gap-1.5">
              {item.to && !last ? (
                <LocaleLink
                  to={item.to}
                  className="max-w-[10rem] truncate hover:text-foreground"
                >
                  {item.label}
                </LocaleLink>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "max-w-[14rem] truncate",
                    last && "font-medium text-foreground",
                  )}
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground/70",
                    rtl && "rtl-flip",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
