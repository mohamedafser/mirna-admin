import { ImageOff } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/**
 * Catalogue thumbnail (square, or 4:3 with aspect="wide"). next/image serves a resized copy matching
 * `sizes` (thumbnails never download the original upload).
 */
export function CatalogueImage({
  src,
  alt,
  sizes,
  className,
  priority = false,
  aspect = "square",
}: {
  src: string | null;
  alt: string;
  /** Rendered width, e.g. "40px" or "(min-width: 1024px) 320px, 100vw". */
  sizes: string;
  className?: string;
  priority?: boolean;
  /** "wide" = 4:3 (category cards). */
  aspect?: "square" | "wide";
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground",
        aspect === "square" ? "aspect-square" : "aspect-[4/3]",
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <ImageOff aria-hidden className="size-1/3 max-h-6 max-w-6" />
      )}
    </span>
  );
}
