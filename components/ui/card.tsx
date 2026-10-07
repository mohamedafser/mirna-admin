import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-2xl border bg-card p-5 text-card-foreground sm:p-6", className)}
      {...props}
    />
  );
}

/** Rounded, tinted square holding an icon. */
export function IconBadge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center bg-brand-soft text-brand-soft-foreground [&_svg]:size-5",
        className,
      )}
    >
      <Icon />
    </span>
  );
}

export function CardHeader({
  icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      {icon && <IconBadge icon={icon} />}
      <div className="min-w-0 flex-1">
        <h2 className="caps text-xs leading-tight font-medium">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Label/value rows used for read-only details. */
export function DetailList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; icon?: LucideIcon }>;
}) {
  return (
    <dl className="divide-y text-sm">
      {items.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
        >
          <dt className="flex items-center gap-2.5 text-muted-foreground">
            {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
            {label}
          </dt>
          <dd className="min-w-0 text-end font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
