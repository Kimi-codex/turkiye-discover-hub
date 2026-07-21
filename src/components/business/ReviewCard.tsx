import type { Review } from "@/types/domain";
import { RatingStars } from "@/components/business/RatingStars";
import { useT } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

interface ReviewCardProps {
  review: Review;
}

export function ReviewCard({ review }: ReviewCardProps) {
  const t = useT();
  const initials = review.authorName
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <article
      className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"
      lang={typeof review.reviewLanguage === "string" ? review.reviewLanguage : undefined}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand"
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {review.authorName}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(review.reviewDate).toLocaleDateString()}
            </div>
          </div>
        </div>
        <RatingStars value={review.rating} size="sm" showValue={false} />
      </header>
      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">
        {review.reviewText}
      </p>
      {review.ownerReply && (
        <div className="mt-4 rounded-xl bg-muted/60 p-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("biz.contact")}
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            {review.ownerReply}
          </p>
        </div>
      )}
      {review.source === "google" && (
        <div className="mt-3">
          <Badge variant="outline" className="text-[10px]">
            Google
          </Badge>
        </div>
      )}
    </article>
  );
}
