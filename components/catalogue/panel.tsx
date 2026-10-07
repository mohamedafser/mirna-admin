import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Compact titled card used across the catalogue screens. */
export function Panel({
  title,
  action,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & { title?: ReactNode; action?: ReactNode }) {
  return (
    <section
      className={cn("rounded-2xl border bg-card p-4 text-card-foreground sm:p-5", className)}
      {...props}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="caps text-xs font-medium">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
