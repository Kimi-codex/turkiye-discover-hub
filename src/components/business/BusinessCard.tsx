import { Heart, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import type { Business } from "@/types/domain";
import { getBusinessImageUrl } from "@/lib/images/storage";
import { pickLocalized, useLocale, useT } from "@/lib/i18n";
import { LocaleLink } from "@/components/site/LocaleLink";
import { RatingStars } from "./RatingStars";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isOpenNow } from "@/lib/business/opening-hours";

interface BusinessCardProps {
  business: Business;
  variant?: "grid" | "horizontal" | "compact";
  className?: string;
  eager?: boolean;
}

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
  const priceStr = business.priceLevel
    ? "$".repeat(business.priceLevel)
    : null;

  const districtName = business.district
    ? pickLocalized(business.district.name, locale)
    : null;
  const cityName = pickLocalized(business.city.name, locale);
  const primaryCat = pickLocalized(business.primaryCategory.name, locale);

  const commonInner = (
    <>
      <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {business.isFeatured && (
            <Badge className="gap-1 bg-brand text-brand-foreground shadow-sm hover:bg-brand">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {t("card.featured")}
            </Badge>
          )}
          {business.isVerified && (
            <Badge className="gap-1 bg-white/95 text-primary shadow-sm hover:bg-white">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {t("card.verified")}
            </Badge>
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
    </>
  );

  if (variant === "horizontal") {
    return (
      <LocaleLink
        to={`/place/${business.slug}`}
        className={cn(
          "group grid grid-cols-[7.5rem_minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-elevated)] sm:grid-cols-[10rem_minmax(0,1fr)]",
          className,
        )}
      >
        <div className="relative aspect-square overflow-hidden bg-muted sm:aspect-auto">
          <img
            src={coverUrl}
            alt={business.name}
            loading={eager ? "eager" : "lazy"}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 min-w-0 text-base font-semibold text-foreground">
              {business.name}
            </h3>
            {business.isVerified && (
              <ShieldCheck
                className="h-4 w-4 shrink-0 text-brand"
                aria-label={t("card.verified")}
              />
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {primaryCat} · {cityName}
            {districtName ? ` · ${districtName}` : ""}
          </p>
          <RatingStars
            value={business.rating}
            reviewCount={business.reviewCount}
            reviewLabel={t("card.reviews")}
            size="sm"
          />
          <OpenBadge openNow={openNow} price={priceStr} />
        </div>
      </LocaleLink>
    );
  }

  const aspect = variant === "compact" ? "aspect-[4/3]" : "aspect-[4/3]";

  return (
    <LocaleLink
      to={`/place/${business.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-elevated)]",
        className,
      )}
    >
      <div className={cn("relative overflow-hidden bg-muted", aspect)}>
        <img
          src={coverUrl}
          alt={business.name}
          loading={eager ? "eager" : "lazy"}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {commonInner}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 min-w-0 text-base font-semibold text-foreground">
            {business.name}
          </h3>
          {priceStr && (
            <span className="shrink-0 text-sm font-semibold text-muted-foreground">
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
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <RatingStars
            value={business.rating}
            reviewCount={business.reviewCount}
            reviewLabel={t("card.reviews")}
            size="sm"
          />
          <OpenBadge openNow={openNow} price={null} />
        </div>
      </div>
    </LocaleLink>
  );
}

function OpenBadge({
  openNow,
  price,
}: {
  openNow: boolean | null;
  price: string | null;
}) {
  const t = useT();
  if (openNow === null) return price ? <span className="text-xs">{price}</span> : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        openNow
          ? "bg-success/12 text-success"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          openNow ? "bg-success" : "bg-muted-foreground",
        )}
      />
      {openNow ? t("card.open_now") : t("card.closed_now")}
    </span>
  );
}

export function BusinessCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
