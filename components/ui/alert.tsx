import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

const tones = {
  error: { className: "border-error/30 bg-error/8 text-error", icon: CircleAlert },
  warning: { className: "border-warning/30 bg-warning/10 text-foreground", icon: TriangleAlert },
  success: { className: "border-success/30 bg-success/10 text-foreground", icon: CircleCheck },
} as const;

export function Alert({
  tone = "error",
  className,
  children,
  ...props
}: ComponentProps<"div"> & { tone?: keyof typeof tones }) {
  const { className: toneClass, icon: Icon } = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
        toneClass,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="mt-px size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
