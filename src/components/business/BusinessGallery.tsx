import { useState } from "react";
import { ImageIcon } from "lucide-react";
import type { BusinessImage as BusinessImageRow } from "@/types/domain";
import { useT } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BusinessImage } from "./BusinessImage";
import { cn } from "@/lib/utils";

interface BusinessGalleryProps {
  images: BusinessImageRow[];
  businessName: string;
}

export function BusinessGallery({ images, businessName }: BusinessGalleryProps) {
  const t = useT();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  const addFailed = (id: string) => {
    setFailedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const validItems = images.filter((img) => !failedIds.has(img.id));
  const main = validItems[0];
  const thumbs = validItems.slice(1, 5);

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
          key={main.id}
          className="group relative col-span-2 row-span-2 aspect-[4/3] overflow-hidden rounded-2xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:aspect-auto sm:rounded-none"
          aria-label={`${businessName} — ${t("biz.view_all_photos")}`}
        >
          <BusinessImage
            image={main}
            alt={businessName}
            loading="eager"
            onLoadError={() => addFailed(main.id)}
            className="h-full w-full transition-transform duration-500 group-hover:scale-[1.02]"
          />
        </button>
        {[0, 1, 2, 3].map((i) => {
          const img = thumbs[i];
          const isLast = i === 3 && validItems.length > 5;
          return (
            <button
              key={img?.id ?? `thumb-${i}`}
              type="button"
              onClick={() => setOpenIndex(i + 1)}
              disabled={!img}
              className={cn(
                "group relative hidden overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block",
                !img && "cursor-default",
              )}
              aria-label={
                isLast
                  ? `${t("biz.view_all_photos")} (${validItems.length})`
                  : `${businessName} — ${i + 2}`
              }
            >
              {img ? (
                <>
                  <BusinessImage
                    image={img}
                    alt={`${businessName} ${i + 2}`}
                    onLoadError={() => addFailed(img.id)}
                    className="h-full w-full transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                  {isLast && (
                    <div className="absolute inset-0 grid place-items-center bg-primary/60 text-primary-foreground">
                      <span className="text-sm font-semibold">
                        +{validItems.length - 5} {t("biz.view_all_photos")}
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

      <div className="mt-2 flex justify-end sm:hidden">
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm"
        >
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {t("biz.view_all_photos")} ({validItems.length})
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
            {validItems.map((img, i) => (
              <BusinessImage
                key={img.id}
                image={img}
                alt={`${businessName} ${i + 1}`}
                className="w-full rounded-lg object-cover"
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
