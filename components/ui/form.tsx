import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

/**
 * Shared look for every form control (text inputs, textareas and the Combobox
 * dropdown trigger) so they render identically side by side.
 */
export const controlClassName = cn(
  "w-full border border-border bg-card px-3.5 text-base text-foreground sm:text-sm",
  "transition-[border-color] placeholder:text-muted-foreground",
  "hover:border-input focus-visible:border-foreground focus-visible:outline-none",
  "disabled:opacity-60 aria-invalid:border-error",
);

/**
 * Text input with an optional leading icon and trailing element (e.g. a
 * show-password button). Icon positions use logical insets, so they swap
 * sides in RTL.
 */
export function Input({
  className,
  icon: Icon,
  trailing,
  ...props
}: ComponentProps<"input"> & { icon?: LucideIcon; trailing?: ReactNode }) {
  return (
    <div className="relative">
      {Icon && (
        <Icon
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-[1.125rem] -translate-y-1/2 text-muted-foreground"
        />
      )}
      <input
        className={cn(
          controlClassName,
          "h-11 appearance-none [&::-webkit-search-cancel-button]:hidden",
          Icon && "ps-10",
          trailing != null && "pe-11",
          className,
        )}
        {...props}
      />
      {trailing && <div className="absolute end-1 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClassName, "min-h-24 py-2.5", className)} {...props} />;
}

/**
 * Label + control + hint/error, wired for screen readers: the control gets
 * aria-describedby / aria-invalid via `describedBy` and `invalid`.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Text shown after the label, e.g. "Optional". */
  optional?: string;
  children: (a11y: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
  className?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id} className="flex items-baseline gap-1.5">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">{optional}</span>}
      </Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
