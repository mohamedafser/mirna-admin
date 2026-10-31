import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  CreditCard,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PaymentStatus } from "@/lib/payments/rules";

const styles: Record<
  PaymentStatus | "none",
  { icon: LucideIcon; tone: "neutral" | "primary" | "success" | "warning" | "error" }
> = {
  PENDING: { icon: Clock, tone: "warning" },
  PROCESSING: { icon: CircleDashed, tone: "primary" },
  PAID: { icon: CircleCheck, tone: "success" },
  FAILED: { icon: CircleAlert, tone: "error" },
  CANCELLED: { icon: CircleSlash, tone: "neutral" },
  PARTIALLY_REFUNDED: { icon: Undo2, tone: "primary" },
  REFUNDED: { icon: Undo2, tone: "neutral" },
  none: { icon: CreditCard, tone: "neutral" },
};

/** Payment status pill (icon + text). `null`: the order isn't paid online. */
export function PaymentStatusBadge({
  status,
  labels,
}: {
  status: PaymentStatus | null;
  labels: Record<PaymentStatus | "none", string>;
}) {
  const key = status ?? "none";
  const { icon: Icon, tone } = styles[key];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {labels[key]}
    </Badge>
  );
}
