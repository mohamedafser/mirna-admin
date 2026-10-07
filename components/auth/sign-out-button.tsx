"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { dropdownItemClassName } from "@/components/ui/dropdown";
import { signOut } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

type Variant = "button" | "icon" | "menuItem";

function SubmitButton({ variant }: { variant: Variant }) {
  const { messages } = useI18n();
  // Disabled while the sign-out request is in flight → no duplicate requests.
  const { pending } = useFormStatus();
  const label = pending ? messages.auth.signingOut : messages.auth.signOut;
  // Exit arrow points "out" of the reading direction, so it mirrors in RTL.
  const icon = pending ? (
    <LoaderCircle aria-hidden className="animate-spin" />
  ) : (
    <LogOut aria-hidden className="rtl:-scale-x-100" />
  );

  if (variant === "menuItem") {
    return (
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={cn(dropdownItemClassName, "text-error [&_svg]:text-error")}
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      variant={variant === "icon" ? "ghost" : "outline"}
      size={variant === "icon" ? "icon-sm" : "md"}
      aria-label={variant === "icon" ? label : undefined}
      title={variant === "icon" ? label : undefined}
    >
      {icon}
      {variant !== "icon" && label}
    </Button>
  );
}

/** Sign-out form (Server Action). Works from any page, menu or drawer. */
export function SignOutButton({
  variant = "button",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const { locale } = useI18n();
  return (
    <form action={signOut} className={className}>
      <input type="hidden" name="locale" value={locale} />
      <SubmitButton variant={variant} />
    </form>
  );
}
