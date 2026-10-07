import { cn } from "@/lib/utils/cn";

/**
 * Monogram + wordmark in the storefront's style (thin, widely tracked display
 * type). Replace with the final Mirna logo later.
 */
export function Brand({
  name,
  className,
  nameClassName,
  size = "md",
}: {
  name: string;
  className?: string;
  /** Extra classes for the wordmark (e.g. hide it in the collapsed sidebar). */
  nameClassName?: string;
  size?: "md" | "lg";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center justify-center bg-primary font-display font-medium text-primary-foreground",
          size === "lg" ? "size-11 text-lg" : "size-9 text-base",
        )}
      >
        M
      </span>
      <span
        className={cn(
          "caps-wide leading-none font-light whitespace-nowrap",
          size === "lg" ? "text-base" : "text-[0.8125rem]",
          nameClassName,
        )}
      >
        {name}
      </span>
    </span>
  );
}
