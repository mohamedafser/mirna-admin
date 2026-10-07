import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

// Outlined, uppercase labels (storefront style); a faint tint keeps statuses
// scannable in dense admin tables.
const tones = {
  neutral: "border-border text-muted-foreground",
  primary: "border-foreground/70 text-foreground",
  success: "border-success/40 bg-success/5 text-success",
  warning: "border-warning/40 bg-warning/5 text-warning",
  error: "border-error/40 bg-error/5 text-error",
} as const;

/** Small pill for statuses and roles. `dot` adds a status dot. */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: keyof typeof tones; dot?: boolean }) {
  return (
    <span
      className={cn(
        "caps inline-flex items-center gap-1.5 border px-2 py-0.5 text-[0.625rem] font-medium tracking-[0.12em] [&_svg]:size-3",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
