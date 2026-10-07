import { cn } from "@/lib/utils/cn";

function initials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/** Initials avatar (decorative; the name/email is shown next to it). */
export function Avatar({
  name,
  email,
  className,
}: {
  name: string | null;
  email: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center bg-primary font-display text-xs font-semibold text-primary-foreground",
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}
