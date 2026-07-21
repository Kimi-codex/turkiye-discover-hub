import { useState } from "react";
import { ImageIcon } from "lucide-react";
import type { BusinessImage } from "@/types/domain";
import { getBusinessImageUrl } from "@/lib/images/storage";
import { useT } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface BusinessGalleryProps {
  images: BusinessImage[];
  businessName: string;
}

/**
 * 1-large + 4-small hero gallery per the reference screenshot.
 * On mobile stacks to a single large tile with "view all" overlay.
 */
export function BusinessGallery({ images, businessName }: BusinessGalleryProps) {
  const t = useT();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const items = images.length > 0 ? images : [];
  const main = items[0];
  const thumbs = items.slice(1, 5);

  if (!main) {
    return (
      <div className="grid aspect-[16/9] w-full place-items-center rounded-2xl bg-muted text-muted-foreground">
        <ImageIcon className="h-10 w-10" aria-hidden="true" />
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-2 overflow-hidden rounded-2xl sm:grid-cols-4 sm:grid-rows-2">
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="group relative col-span-2 row-span-2 aspect-[4/3] overflow-hidden rounded-2xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:aspect-auto sm:rounded-none"
          aria-label={`${businessName} — ${t("biz.view_all_photos")}`}
        >
          <img
            src={getBusinessImageUrl(main)}
            alt={businessName}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            loading="eager"
          />
        </button>
        {[0, 1, 2, 3].map((i) => {
          const img = thumbs[i];
          const isLast = i === 3 && items.length > 5;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIndex(i + 1)}
              disabled={!img}
              className={cn(
                "group relative hidden overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block",
                !img && "cursor-default",
              )}
              aria-label={
                isLast
                  ? `${t("biz.view_all_photos")} (${items.length})`
                  : `${businessName} — ${i + 2}`
              }
            >
              {img ? (
                <>
                  <img
                    src={getBusinessImageUrl(img)}
                    alt={`${businessName} ${i + 2}`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                  {isLast && (
                    <div className="absolute inset-0 grid place-items-center bg-primary/60 text-primary-foreground">
                      <span className="text-sm font-semibold">
                        +{items.length - 5} {t("biz.view_all_photos")}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="h-full w-full bg-muted" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {/* Mobile-only "view all" pill */}
      <div className="mt-2 flex justify-end sm:hidden">
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm"
        >
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {t("biz.view_all_photos")} ({items.length})
        </button>
      </div>

      <Dialog
        open={openIndex !== null}
        onOpenChange={(v) => !v && setOpenIndex(null)}
      >
        <DialogTrigger asChild>
          <span className="sr-only" />
        </DialogTrigger>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-3 sm:p-6">
          <DialogTitle className="sr-only">{businessName}</DialogTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((img, i) => (
              <img
                key={img.id}
                src={getBusinessImageUrl(img)}
                alt={`${businessName} ${i + 1}`}
                className="w-full rounded-lg object-cover"
                loading={i < 2 ? "eager" : "lazy"}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
