import { CircleCheck, CircleSlash } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Active / Inactive pill: icon + text, so status never relies on color alone. */
export function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return active ? (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      {activeLabel}
    </Badge>
  ) : (
    <Badge tone="neutral">
      <CircleSlash aria-hidden />
      {inactiveLabel}
    </Badge>
  );
}
