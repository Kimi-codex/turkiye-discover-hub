import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import {
  Globe,
  MapPin,
  Navigation,
  Phone,
  Share2,
  Flag,
  Heart,
  ShieldCheck,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { BusinessGallery } from "@/components/business/BusinessGallery";
import { OpeningHoursBlock } from "@/components/business/OpeningHours";
import { RatingStars } from "@/components/business/RatingStars";
import { ReviewCard } from "@/components/business/ReviewCard";
import { BusinessCard } from "@/components/business/BusinessCard";
import { services } from "@/lib/repos";
import {
  DEFAULT_LOCALE,
  pickLocalized,
  translate,
  type Locale,
} from "@/lib/i18n";
import { buildHreflang, canonicalFor } from "@/lib/seo/hreflang";
import { getBusinessImageUrl } from "@/lib/images/storage";

const businessQuery = (slug: string) =>
  queryOptions({
    queryKey: ["business", slug],
    queryFn: async () => {
      const b = await services.businesses.getBySlug(slug);
      if (!b) throw notFound();
      const [reviews, similar] = await Promise.all([
        services.reviews.listForBusiness(b.id, 6),
        services.businesses.getSimilar(b, 4),
      ]);
      return { business: b, reviews, similar };
    },
  });

export const Route = createFileRoute("/$lang/place/$slug")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(businessQuery(params.slug)),
  head: ({ params, loaderData }) => {
    const locale = (params.lang as Locale) ?? DEFAULT_LOCALE;
    const path = `/place/${params.slug}`;
    if (!loaderData) {
      return {
        meta: [
          { title: translate(locale, "notfound.title") },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const b = loaderData.business;
    const desc = pickLocalized(b.description, locale) || b.address;
    const title = `${b.name} — ${pickLocalized(b.primaryCategory.name, locale)} · ${pickLocalized(b.city.name, locale)}`;
    const cover = getBusinessImageUrl(
      b.images.find((i) => i.isCover) ?? b.images[0],
    );
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: b.name,
      image: cover,
      address: {
        "@type": "PostalAddress",
        streetAddress: b.address,
        addressLocality: pickLocalized(b.city.name, "en"),
        addressCountry: "TR",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: b.latitude,
        longitude: b.longitude,
      },
      telephone: b.phone ?? undefined,
      url: b.website ?? undefined,
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: b.rating,
        reviewCount: b.reviewCount,
      },
      priceRange: b.priceLevel ? "$".repeat(b.priceLevel) : undefined,
    };
    return {
      meta: [
        { title },
        { name: "description", content: desc.slice(0, 200) },
        { property: "og:title", content: title },
        { property: "og:description", content: desc.slice(0, 200) },
        { property: "og:type", content: "business.business" },
        { property: "og:url", content: canonicalFor(locale, path) },
        { property: "og:image", content: cover },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: cover },
      ],
      links: [
        { rel: "canonical", href: canonicalFor(locale, path) },
        ...buildHreflang(path),
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLd),
        },
      ],
    };
  },
  component: BusinessDetailsPage,
  notFoundComponent: NotFound,
});

function NotFound() {
  const { lang } = Route.useParams();
  const locale = (lang as Locale) ?? DEFAULT_LOCALE;
  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-md flex-col items-center justify-center px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">{translate(locale, "notfound.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {translate(locale, "notfound.desc")}
      </p>
      <Button asChild className="mt-6">
        <a href={`/${locale}`}>{translate(locale, "common.back_home")}</a>
      </Button>
    </div>
  );
}

function BusinessDetailsPage() {
  const { lang } = Route.useParams();
  const locale = lang as Locale;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const { data } = useSuspenseQuery(businessQuery(Route.useParams().slug));
  const { business: b, reviews, similar } = data;

  const desc = pickLocalized(b.description, locale);
  const descOriginal = pickLocalized(b.description, b.originalLanguage);
  const hasDescInLocale = !!b.description[locale];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("breadcrumb.home"), to: "/" },
          {
            label: pickLocalized(b.primaryCategory.name, locale),
            to: `/${b.primaryCategory.slug}`,
          },
          {
            label: pickLocalized(b.city.name, locale),
            to: `/${b.city.slug}`,
          },
          { label: b.name },
        ]}
      />

      {/* Header */}
      <header className="mt-5 grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-brand-soft text-brand hover:bg-brand-soft">
            {pickLocalized(b.primaryCategory.name, locale)}
          </Badge>
          {b.isVerified && (
            <Badge className="gap-1 bg-primary text-primary-foreground hover:bg-primary">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {t("card.verified")}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold sm:text-3xl md:text-4xl">
              {b.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <RatingStars
                value={b.rating}
                reviewCount={b.reviewCount}
                reviewLabel={t("card.reviews")}
              />
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate">{b.address}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {b.phone && (
            <Button asChild variant="default" size="sm" className="gap-2">
              <a href={`tel:${b.phone}`}>
                <Phone className="h-4 w-4" aria-hidden="true" />
                {t("biz.call")}
              </a>
            </Button>
          )}
          {b.website && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href={b.website} target="_blank" rel="noreferrer noopener">
                <Globe className="h-4 w-4" aria-hidden="true" />
                {t("biz.website")}
              </a>
            </Button>
          )}
          {b.googleMapsUrl && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a
                href={b.googleMapsUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                {t("biz.directions")}
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2">
            <Heart className="h-4 w-4" aria-hidden="true" />
            {t("biz.save")}
          </Button>
          <Button variant="ghost" size="sm" className="gap-2">
            <Share2 className="h-4 w-4" aria-hidden="true" />
            {t("biz.share")}
          </Button>
          <Button variant="ghost" size="sm" className="gap-2">
            <Flag className="h-4 w-4" aria-hidden="true" />
            {t("biz.report")}
          </Button>
        </div>
      </header>

      {/* Gallery */}
      <div className="mt-6">
        <BusinessGallery images={b.images} businessName={b.name} />
      </div>

      {/* Body: main + sticky info card */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="section-overview">
            <h2 id="section-overview" className="text-lg font-bold sm:text-xl">
              {t("biz.overview")}
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground sm:text-base">
              {desc || descOriginal || "—"}
            </p>
            {!hasDescInLocale && descOriginal && (
              <p className="mt-2 text-xs italic text-muted-foreground">
                Original language: {b.originalLanguage.toUpperCase()}
              </p>
            )}
            {b.services.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">{t("biz.services")}</h3>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {b.services.map((s) => (
                    <li key={s.key}>
                      <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs">
                        {s.key.replace(/_/g, " ")}
                        {s.value && s.value !== "Yes" ? ` · ${s.value}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="section-location">
            <h2 id="section-location" className="text-lg font-bold sm:text-xl">
              {t("biz.location")}
            </h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
              <div
                className="grid aspect-[16/8] w-full place-items-center bg-surface-muted text-muted-foreground"
                aria-label="Map preview"
              >
                <MapPin className="h-8 w-8" aria-hidden="true" />
              </div>
              <div className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{b.address}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {b.latitude.toFixed(4)}, {b.longitude.toFixed(4)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a
                      href={b.googleMapsUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <Navigation className="h-4 w-4" aria-hidden="true" />
                      {t("biz.directions")}
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.clipboard) {
                        navigator.clipboard.writeText(b.address).catch(() => {});
                      }
                    }}
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    {t("biz.copy_address")}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="section-reviews">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="section-reviews" className="text-lg font-bold sm:text-xl">
                {t("biz.reviews")}
              </h2>
              <Button variant="outline" size="sm">
                {t("biz.write_review")}
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {reviews.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
          </section>
        </div>

        {/* Sticky info card */}
        <aside className="min-w-0">
          <div className="sticky top-24 space-y-5">
            <OpeningHoursBlock hours={b.openingHours} />
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold">{t("biz.contact")}</h3>
              <dl className="mt-3 space-y-2 text-sm">
                {b.phone && (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                    <Phone
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <a
                      className="truncate text-foreground hover:underline"
                      href={`tel:${b.phone}`}
                    >
                      {b.phone}
                    </a>
                  </div>
                )}
                {b.website && (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                    <Globe
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <a
                      className="truncate text-foreground hover:underline"
                      href={b.website}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {b.website.replace(/^https?:\/\//, "")}
                    </a>
                  </div>
                )}
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                  <MapPin
                    className="mt-0.5 h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-foreground">{b.address}</span>
                </div>
              </dl>
              <Button className="mt-4 w-full gap-2" variant="outline">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {t("biz.claim")}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* Similar */}
      {similar.length > 0 && (
        <section className="mt-14">
          <h2 className="text-lg font-bold sm:text-xl">
            {t("sections.similar")}
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {similar.map((s) => (
              <BusinessCard key={s.id} business={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
