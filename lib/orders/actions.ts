"use server";

import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { cancelUnpaidOrder } from "@/lib/payments/orders";
import { isCaptured, isOpen, refundableMinor, type RefundStatus } from "@/lib/payments/rules";
import { getStripe, isStripeError } from "@/lib/payments/stripe";
import { PaymentsNotConfiguredError, syncPaymentIntent } from "@/lib/payments/sync";
import { createClient } from "@/lib/supabase/server";
import { canTransition, isOrderStatus } from "./rules";

export type OrderActionError =
  | "forbidden"
  | "notFound"
  | "invalidTransition"
  | "paymentRequired"
  | "paymentCaptured"
  | "paymentsNotConfigured"
  | "stripe"
  | "conflict"
  | "network"
  | "unexpected";

export type OrderActionResult = { ok: true } | { ok: false; error: OrderActionError };

// orders_guard_status (migrations 018, 044) raises these.
const DB_ERRORS: Record<string, OrderActionError> = {
  "orders:invalid_transition": "invalidTransition",
  "orders:payment_required": "paymentRequired",
  "orders:payment_captured": "paymentCaptured",
  // Cancelled through cancelUnpaidOrder() below; reaching this means the
  // payment changed meanwhile.
  "orders:payment_open": "conflict",
};

/**
 * Moves an order to its next status. Re-checks the admin session, validates
 * the move against the workflow (payment included), then updates with the
 * admin's own session: RLS (orders_update_admin) allows admins only, the
 * column grant allows only `status`, and the orders_guard_status trigger
 * rejects invalid moves. `from` is the status the admin was looking at: if
 * someone else changed the order meanwhile, nothing is updated ("conflict").
 * updated_at is set by the orders_set_updated_at trigger. Prices and items
 * are never touched.
 *
 * Cancelling an order that awaits an online payment goes through
 * cancelUnpaidOrder() instead, which cancels its PaymentIntent at Stripe
 * first, so the customer can't pay a cancelled order.
 */
export async function updateOrderStatus(
  orderId: unknown,
  from: unknown,
  to: unknown,
): Promise<OrderActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(orderId)) return { ok: false, error: "notFound" };
  if (!isOrderStatus(from) || !isOrderStatus(to)) return { ok: false, error: "invalidTransition" };

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("orders")
    .select("status, payment_status")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) {
    console.error(
      `[orders] read failed: code=${readError.code || "-"} message=${readError.message}`,
    );
    return { ok: false, error: readError.code ? "unexpected" : "network" };
  }
  if (!current) return { ok: false, error: "notFound" };
  if (current.status !== from) return { ok: false, error: "conflict" };
  if (!canTransition(from, to, current.payment_status)) {
    return {
      ok: false,
      error:
        to === "CANCELLED"
          ? "paymentCaptured"
          : current.payment_status
            ? "paymentRequired"
            : "invalidTransition",
    };
  }

  if (to === "CANCELLED" && isOpen(current.payment_status)) {
    try {
      const result = await cancelUnpaidOrder(orderId);
      if (result === "stripe_error") return { ok: false, error: "stripe" };
      if (result === "not_found") return { ok: false, error: "notFound" };
      if (result === "paid") return { ok: false, error: "paymentCaptured" };
      if (result === "not_pending") return { ok: false, error: "conflict" };
    } catch (error) {
      if (error instanceof PaymentsNotConfiguredError) {
        return { ok: false, error: "paymentsNotConfigured" };
      }
      console.error(
        `[orders] cancel unpaid failed: ${error instanceof Error ? error.message : error}`,
      );
      return { ok: false, error: "unexpected" };
    }
    refresh();
    return { ok: true };
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();

  if (error) {
    const known = DB_ERRORS[error.message];
    if (known) return { ok: false, error: known };
    console.error(
      `[orders] update status failed: code=${error.code || "-"} message=${error.message || "-"}`,
    );
    // Fetch failures surface with an empty code.
    return { ok: false, error: error.code ? "unexpected" : "network" };
  }
  // Missing, or no longer in `from` (changed by someone else).
  if (!data) return { ok: false, error: "conflict" };

  refresh();
  return { ok: true };
}

/** Statuses an order can still be cancelled from (it hasn't shipped). */
const CANCELLABLE = new Set(["PENDING", "CONFIRMED", "PROCESSING"]);

/**
 * Cancels an order that was paid online and hasn't shipped: everything
 * still refundable on its payments is refunded through Stripe, then Stripe's
 * state is applied (syncPaymentIntent), which marks the payment and the
 * order REFUNDED and puts the items back into stock (migration 044).
 *
 * `from` is the status the admin was looking at ("conflict" if it changed).
 * The idempotency key is per order and payment, so a double click or a retry
 * after a timeout refunds once.
 */
export async function cancelAndRefundOrder(
  orderId: unknown,
  from: unknown,
): Promise<OrderActionResult> {
  const admin = await getAdminOrNull();
  if (!admin) return { ok: false, error: "forbidden" };
  if (!isUuid(orderId) || !isOrderStatus(from)) return { ok: false, error: "notFound" };
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "paymentsNotConfigured" };

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      `status, payment_status,
       payments(id, stripe_payment_intent_id, status, amount_received_minor, refunds(amount_minor, status))`,
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error(`[orders] cancel+refund read failed: ${error.code || "-"} ${error.message}`);
    return { ok: false, error: error.code ? "unexpected" : "network" };
  }
  if (!order) return { ok: false, error: "notFound" };
  if (order.status !== from) return { ok: false, error: "conflict" };
  if (!CANCELLABLE.has(order.status)) return { ok: false, error: "invalidTransition" };
  if (!isCaptured(order.payment_status) || order.payment_status === "REFUNDED") {
    return { ok: false, error: "invalidTransition" };
  }

  const payments = order.payments as unknown as {
    id: string;
    stripe_payment_intent_id: string;
    status: string;
    amount_received_minor: number;
    refunds: { amount_minor: number; status: RefundStatus }[];
  }[];
  try {
    for (const payment of payments) {
      if (payment.status !== "PAID" && payment.status !== "PARTIALLY_REFUNDED") continue;
      const amount = refundableMinor(
        BigInt(payment.amount_received_minor),
        payment.refunds.map((r) => ({ amountMinor: BigInt(r.amount_minor), status: r.status })),
      );
      if (amount > BigInt(0)) {
        await stripe.refunds.create(
          {
            payment_intent: payment.stripe_payment_intent_id,
            amount: Number(amount),
            reason: "requested_by_customer",
            metadata: {
              order_id: orderId,
              requested_by: admin.id,
              note: "Order cancelled by an admin",
            },
          },
          { idempotencyKey: `mirna-cancel-${orderId}-${payment.id}` },
        );
      }
      await syncPaymentIntent(payment.stripe_payment_intent_id);
    }
  } catch (refundError) {
    if (refundError instanceof PaymentsNotConfiguredError) {
      return { ok: false, error: "paymentsNotConfigured" };
    }
    console.error(
      `[orders] cancel+refund failed: ${isStripeError(refundError) ? refundError.message : refundError}`,
    );
    return { ok: false, error: "stripe" };
  }

  refresh();
  return { ok: true };
}
