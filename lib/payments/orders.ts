import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeError } from "./stripe";
import { PaymentsNotConfiguredError, syncPaymentIntent } from "./sync";

export type CancelUnpaidResult =
  "cancelled" | "not_found" | "not_pending" | "paid" | "stripe_error";

/**
 * Cancels an order that must be paid online but wasn't (its deadline passed,
 * or an admin cancelled it). Its live PaymentIntents are cancelled at Stripe
 * FIRST, so a customer can't pay an order that no longer exists; one that
 * Stripe can no longer cancel (it's processing or already succeeded) is
 * synced instead, and the order is then left alone ("paid"). Only then does
 * cancel_unpaid_order() cancel the order, which puts its stock back.
 */
export async function cancelUnpaidOrder(orderId: string): Promise<CancelUnpaidResult> {
  const stripe = getStripe();
  const admin = createAdminClient();
  if (!stripe || !admin) throw new PaymentsNotConfiguredError();

  const { data: open, error } = await admin
    .from("payments")
    .select("stripe_payment_intent_id")
    .eq("order_id", orderId)
    .in("status", ["PENDING", "PROCESSING", "FAILED"]);
  if (error) throw new Error(`open payments lookup failed: ${error.message}`);

  for (const { stripe_payment_intent_id: id } of open) {
    try {
      await stripe.paymentIntents.cancel(id, { cancellation_reason: "abandoned" });
    } catch (cancelError) {
      // Already cancelled, processing or succeeded: Stripe's state decides.
      if (!isStripeError(cancelError) || cancelError.code !== "payment_intent_unexpected_state") {
        console.error(
          `[payments] cancel ${id} failed: ${isStripeError(cancelError) ? cancelError.message : cancelError}`,
        );
        return "stripe_error";
      }
    }
    await syncPaymentIntent(id);
  }

  const { data: result, error: cancelError } = await admin.rpc("cancel_unpaid_order", {
    p_order_id: orderId,
  });
  if (cancelError) throw new Error(`cancel_unpaid_order failed: ${cancelError.message}`);
  return result as CancelUnpaidResult;
}
