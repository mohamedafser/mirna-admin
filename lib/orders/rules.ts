import type { OrderStatus } from "@/types/domain";

/**
 * Order status workflow, shared by the UI (which buttons to show) and the
 * Server Action (what to accept). The database enforces the same table
 * (trigger orders_guard_status, migration 018), so it is authoritative.
 *
 *   PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
 *   PENDING / CONFIRMED / PROCESSING → CANCELLED
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
  // Reserved for a later refunds phase; never reached from here.
  REFUNDED: [],
};

export function nextStatuses(status: OrderStatus): readonly OrderStatus[] {
  return NEXT[status];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT[from].includes(to);
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
