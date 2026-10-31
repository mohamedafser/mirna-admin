import type { PaymentStatus } from "@/lib/payments/rules";
import type { OrderStatus } from "@/types/domain";

/**
 * Order status workflow, shared by the UI (which buttons to show) and the
 * Server Action (what to accept). The database enforces the same table
 * (trigger orders_guard_status, migration 018), so it is authoritative.
 *
 *   PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
 *   PENDING / CONFIRMED / PROCESSING → CANCELLED
 *
 * Orders paid online (migration 044) also follow their payment: they move
 * forward only once paid (a paid PENDING order is confirmed automatically),
 * a paid order is refunded rather than cancelled (a full refund makes it
 * REFUNDED), and an unpaid one can be cancelled (its PaymentIntent is
 * cancelled at Stripe first). `payment` null: no online payment.
 */
export const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const satisfies readonly OrderStatus[];

const NEXT: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  // Reached through a full refund (Payments), never from here.
  REFUNDED: [],
};

function paymentAllows(to: OrderStatus, payment: PaymentStatus | null): boolean {
  if (payment === null) return true;
  if (to === "CANCELLED") {
    return payment !== "PROCESSING" && payment !== "PAID" && payment !== "PARTIALLY_REFUNDED";
  }
  return payment === "PAID" || payment === "PARTIALLY_REFUNDED";
}

export function nextStatuses(
  status: OrderStatus,
  payment: PaymentStatus | null = null,
): readonly OrderStatus[] {
  return NEXT[status].filter((to) => paymentAllows(to, payment));
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  payment: PaymentStatus | null = null,
): boolean {
  return NEXT[from].includes(to) && paymentAllows(to, payment);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && value in NEXT;
}

/** Date filter presets (?period=), counted back from now. */
export const ORDER_PERIODS = { today: 0, "7d": 7, "30d": 30, "90d": 90 } as const;
export type OrderPeriod = keyof typeof ORDER_PERIODS;

export function isOrderPeriod(value: unknown): value is OrderPeriod {
  return typeof value === "string" && Object.hasOwn(ORDER_PERIODS, value);
}
