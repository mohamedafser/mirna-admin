import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  PackageCheck,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/types/domain";

const styles: Record<
  OrderStatus,
  { icon: LucideIcon; tone: "neutral" | "primary" | "success" | "warning" | "error" }
> = {
  PENDING: { icon: Clock, tone: "warning" },
  CONFIRMED: { icon: CircleCheck, tone: "primary" },
  PROCESSING: { icon: CircleDashed, tone: "primary" },
  SHIPPED: { icon: Truck, tone: "primary" },
  DELIVERED: { icon: PackageCheck, tone: "success" },
  CANCELLED: { icon: CircleSlash, tone: "error" },
  REFUNDED: { icon: Undo2, tone: "neutral" },
};

/** Order status pill: icon + text, so the status never relies on colour alone. */
export function OrderStatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  const { icon: Icon, tone } = styles[status];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
