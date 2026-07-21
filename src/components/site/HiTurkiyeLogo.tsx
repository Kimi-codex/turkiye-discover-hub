import { cn } from "@/lib/utils";

/**
 * HiTürkiye wordmark with a small coral hot-air-balloon glyph.
 * Uses currentColor for the wordmark so it inherits header text color.
 */
export function HiTurkiyeLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-display text-xl font-extrabold tracking-tight",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 28"
        aria-hidden="true"
        className="h-6 w-6 shrink-0"
      >
        <path
          d="M12 1c5 0 9 4 9 9 0 5-4 9-9 12-5-3-9-7-9-12 0-5 4-9 9-9z"
          fill="var(--color-brand)"
          opacity="0.15"
        />
        <path
          d="M12 3c4 0 7 3 7 7s-3 7-7 8c-4-1-7-4-7-8s3-7 7-7z"
          fill="var(--color-brand)"
        />
        <circle cx="12" cy="9" r="2" fill="#fff" />
        <path
          d="M10 18h4l-1 4h-2z"
          fill="var(--color-brand)"
        />
      </svg>
      <span className="text-primary">
        Hi<span className="text-brand">Türkiye</span>
      </span>
    </span>
  );
}
