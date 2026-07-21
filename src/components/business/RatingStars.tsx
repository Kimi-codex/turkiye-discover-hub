import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingStarsProps {
  value: number;
  showValue?: boolean;
  reviewCount?: number;
  reviewLabel?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function RatingStars({
  value,
  showValue = true,
  reviewCount,
  reviewLabel,
  size = "md",
  className,
}: RatingStarsProps) {
  const rounded = Math.round(value * 10) / 10;
  const iconSize =
    size === "lg" ? "h-5 w-5" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const textSize =
    size === "lg" ? "text-base" : size === "sm" ? "text-xs" : "text-sm";

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Star
        className={cn(iconSize, "fill-rating text-rating")}
        aria-hidden="true"
      />
      {showValue && (
        <span className={cn("font-semibold text-foreground", textSize)}>
          {rounded.toFixed(1)}
        </span>
      )}
      {typeof reviewCount === "number" && (
        <span className={cn("text-muted-foreground", textSize)}>
          ({reviewCount.toLocaleString()}
          {reviewLabel ? ` ${reviewLabel}` : ""})
        </span>
      )}
    </div>
  );
}
