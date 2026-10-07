import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Spinner with an accessible label. */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2", className)}>
      <LoaderCircle aria-hidden className="size-5 animate-spin text-primary" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center text-muted-foreground">
      <Spinner label={label} />
    </div>
  );
}

/** Placeholder blocks shown while a page streams in. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="mx-auto max-w-6xl animate-pulse">
      <div className="h-28 rounded-2xl bg-muted" />
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl bg-muted" />
        <div className="h-64 rounded-2xl bg-muted" />
      </div>
    </div>
  );
}

// Plain line icon, as on the storefront.
const iconTones = {
  neutral: "text-muted-foreground",
  error: "text-error",
};

/**
 * Shared layout for empty, error, not-found and unauthorized screens.
 * `action` is typically a Button or link.
 */
export function StatusState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  headingLevel = "h2",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "error";
  headingLevel?: "h1" | "h2";
  className?: string;
}) {
  const Heading = headingLevel;
  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center py-12 text-center", className)}>
      {Icon && (
        <Icon aria-hidden strokeWidth={1.25} className={cn("mb-5 size-9", iconTones[tone])} />
      )}
      <Heading className="caps text-sm font-medium text-balance">{title}</Heading>
      {description && (
        <div className="mt-3 text-sm leading-relaxed text-pretty text-muted-foreground">
          {description}
        </div>
      )}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState(props: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return <StatusState {...props} />;
}
