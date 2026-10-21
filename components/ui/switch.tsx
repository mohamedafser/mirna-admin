import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * On/off switch: a native checkbox (role="switch", so forms, labels and
 * keyboards work as usual) drawn as a track in the theme's primary colour.
 * The thumb slides with the reading direction (RTL-aware).
 */
export function Switch({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <input type="checkbox" role="switch" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className={cn(
          "h-6 w-10 rounded-full border border-input/60 bg-muted transition-colors duration-200",
          "peer-checked:border-primary peer-checked:bg-primary",
          "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/25",
          "peer-disabled:opacity-50",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute start-1 top-1 size-4 rounded-full bg-card shadow-sm transition-transform duration-200",
          "peer-checked:translate-x-4 peer-checked:bg-primary-foreground rtl:peer-checked:-translate-x-4",
        )}
      />
    </span>
  );
}
