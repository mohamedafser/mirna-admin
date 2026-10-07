import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "md" | "sm" | "lg" | "icon" | "icon-sm";

// Square, uppercase, tracked: the storefront's editorial button style.
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
  outline:
    "border border-foreground/80 bg-transparent text-foreground hover:bg-foreground hover:text-background",
  ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-2 px-3.5 text-[0.6875rem] [&_svg]:size-3.5",
  md: "h-10 gap-2.5 px-5 text-xs [&_svg]:size-4",
  lg: "h-11 gap-2.5 px-6 text-xs [&_svg]:size-4",
  icon: "size-10 [&_svg]:size-5",
  "icon-sm": "size-8 [&_svg]:size-4",
};

export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  const isIcon = size === "icon" || size === "icon-sm";
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap",
    !isIcon && "caps",
    "transition-[color,background-color,border-color,opacity]",
    "disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button type={type} className={buttonClassName({ variant, size, className })} {...props} />
  );
}
