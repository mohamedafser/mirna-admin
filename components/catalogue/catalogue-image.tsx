import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/**
 * Catalogue thumbnail (square, or 4:3 with aspect="wide"). next/image serves a resized copy matching
 * `sizes` (thumbnails never download the original upload). Without an image it shows the brand
 * placeholder: the "M" monogram on the soft brand colour, scaled to the tile (container units).
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
        "@container relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border",
        src ? "bg-muted" : "bg-brand-soft text-brand-soft-foreground",
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
        <span
          aria-hidden
          className="font-display text-[42cqw] leading-none font-medium opacity-60 select-none"
        >
          M
        </span>
      )}
    </span>
  );
}
