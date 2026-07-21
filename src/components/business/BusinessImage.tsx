/**
 * BusinessImage — canonical fallback-aware <img> component.
 *
 * ALL business images in the app MUST render through this component
 * (Correction #4: never surface internal error/retry fields to the client;
 *  Correction #5: never generate signed private URLs client-side).
 *
 * Fallback chain (delegated to getBusinessImageUrl):
 *   1. r2_url when storage_status === 'uploaded'
 *   2. source_url when safe http(s)
 *   3. local SVG placeholder
 */

import { useState } from "react";
import type { BusinessImage as BusinessImageRow } from "@/types/domain";
import { getBusinessImageUrl } from "@/lib/images/storage";
import { BUSINESS_IMAGE_PLACEHOLDER } from "@/lib/assets/placeholder";
import { cn } from "@/lib/utils";

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> {
  image: BusinessImageRow | null | undefined;
  alt: string;
  className?: string;
}

export function BusinessImage({ image, alt, className, ...rest }: Props) {
  const initial = getBusinessImageUrl(image);
  const [src, setSrc] = useState(initial);
  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      loading={rest.loading ?? "lazy"}
      decoding={rest.decoding ?? "async"}
      className={cn("bg-muted object-cover", className)}
      onError={() => {
        if (src !== BUSINESS_IMAGE_PLACEHOLDER) setSrc(BUSINESS_IMAGE_PLACEHOLDER);
      }}
    />
  );
}
