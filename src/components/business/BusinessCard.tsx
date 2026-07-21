import { Heart, MapPin, ShieldCheck, Sparkles, Star } from "lucide-react";
import type { Business } from "@/types/domain";
import { getBusinessImageUrl } from "@/lib/images/storage";
import { pickLocalized, useLocale, useT } from "@/lib/i18n";
import { LocaleLink } from "@/components/site/LocaleLink";
import { cn } from "@/lib/utils";
import { isOpenNow } from "@/lib/business/opening-hours";

interface BusinessCardProps {
  business: Business;
  variant?: "grid" | "horizontal" | "compact";
  className?: string;
  eager?: boolean;
}

/**
 * Public business card. Large rounded hero image with floating rating pill,
 * verified/featured badges, save heart, and a tag row underneath.
 */
export function BusinessCard({
  business,
  variant = "grid",
  className,
  eager = false,
}: BusinessCardProps) {
  const t = useT();
  const locale = useLocale();
  const cover = business.images.find((i) => i.isCover) ?? business.images[0];
  const coverUrl = getBusinessImageUrl(cover);
  const openNow = isOpenNow(business.openingHours);
  const priceStr = business.priceLevel ? "$".repeat(business.priceLevel) : null;

  const districtName = business.district
    ? pickLocalized(business.district.name, locale)
    : null;
  const cityName = pickLocalized(business.city.name, locale);
  const primaryCat = pickLocalized(business.primaryCategory.name, locale);

  const tags: string[] = [
    ...business.services.slice(0, 2).map((s) => s.value),
    ...business.attributes
      .slice(0, 2)
      .map((a) => (a.value == null ? a.key : String(a.value))),
  ].slice(0, 3);

  return (
    <LocaleLink
      to={`/place/${business.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-3xl border border-black/5 bg-card shadow-[0_10px_30px_-15px_rgba(15,15,40,0.15)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-20px_rgba(15,15,40,0.25)]",
        className,
      )}
    >
      <div className="relative aspect-[16/11] overflow-hidden bg-muted">
        <img
          src={coverUrl}
          alt={business.name}
          loading={eager ? "eager" : "lazy"}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {/* Top-left: badges */}
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {business.isFeatured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-brand-foreground shadow-sm">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {t("card.featured")}
              </span>
            )}
            {business.isVerified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-primary shadow-sm">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {t("card.verified")}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label={t("biz.save")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/95 text-primary shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Bottom-left: rating pill */}
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-primary shadow-sm">
            <Star
              className="h-3.5 w-3.5 fill-[color:var(--color-rating)] text-[color:var(--color-rating)]"
              aria-hidden="true"
            />
            <span>{business.rating.toFixed(1)}</span>
            <span className="text-muted-foreground">
              ({business.reviewCount})
            </span>
          </span>
          {openNow !== null && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide shadow-sm",
                openNow
                  ? "bg-success/95 text-success-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  openNow ? "bg-success-foreground" : "bg-muted-foreground",
                )}
              />
              {openNow ? t("card.open_now") : t("card.closed_now")}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 min-w-0 font-display text-lg font-bold leading-tight text-primary">
            {business.name}
          </h3>
          {priceStr && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {priceStr}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {primaryCat} · {cityName}
            {districtName ? ` · ${districtName}` : ""}
          </span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-black/5 bg-muted px-2.5 py-0.5 text-[0.7rem] font-medium text-foreground/70"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-xs font-semibold text-brand">
            {t("card.details")} →
          </span>
        </div>
      </div>
    </LocaleLink>
  );
}

export function BusinessCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-black/5 bg-card">
      <div className="aspect-[16/11] w-full animate-pulse bg-muted" />
      <div className="space-y-2 p-5">
        <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
