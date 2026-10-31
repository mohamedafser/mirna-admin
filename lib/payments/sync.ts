import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { PaymentStatus } from "./rules";
import { getStripe } from "./stripe";

/**
 * The one way Stripe's state reaches the database. A PaymentIntent is always
 * re-read from Stripe (never taken from a webhook body or the browser) and
 * applied by sync_stripe_payment() (migration 044), which checks that it was
 * created for that order, for exactly its total, and moves the payment and
 * the order. Applying the current state makes this safe to run any number
 * of times, in any order: webhooks, refunds, cancellations and the
 * "refresh from Stripe" button all come through here.
 */

export interface SyncResult {
  outcome: "applied" | "ignored";
  detail?: string;
  order_id?: string;
  order_number?: number;
  payment_status?: PaymentStatus;
  order_status?: string;
  refund_required?: boolean;
}

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super("Stripe or the Supabase service role key is not configured.");
    this.name = "PaymentsNotConfiguredError";
  }
}

/** The parts of a PaymentIntent the database stores (no card numbers exist here). */
export function paymentIntentState(intent: Stripe.PaymentIntent, refunds: Stripe.Refund[]) {
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const details = charge?.payment_method_details ?? null;
  const card = details?.card ?? null;
  const error = intent.last_payment_error;
  return {
    payment_intent_id: intent.id,
    order_id: intent.metadata?.order_id ?? null,
    status: intent.status,
    amount: intent.amount,
    amount_received: intent.amount_received,
    currency: intent.currency,
    livemode: intent.livemode,
    charge_id: charge?.status === "succeeded" ? charge.id : null,
    amount_refunded: charge?.amount_refunded ?? 0,
    payment_method_type: details?.type ?? null,
    wallet: card?.wallet?.type ?? null,
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
    failure_code: error ? (error.decline_code ?? error.code ?? "payment_failed") : null,
    failure_message: error?.message ?? null,
    refunds: refunds.map((refund) => ({
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      failure_reason: refund.failure_reason ?? null,
      created: refund.created,
      // Set by refundPayment() (lib/payments/actions.ts).
      requested_by: refund.metadata?.requested_by ?? null,
      note: refund.metadata?.note ?? null,
    })),
  };
}

function clients() {
  const stripe = getStripe();
  const admin = createAdminClient();
  if (!stripe || !admin) throw new PaymentsNotConfiguredError();
  return { stripe, admin };
}

export async function syncPaymentIntent(paymentIntentId: string): Promise<SyncResult> {
  const { stripe, admin } = clients();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const refunds =
    intent.amount_received > 0
      ? await stripe.refunds
          .list({ payment_intent: intent.id, limit: 100 })
          .autoPagingToArray({ limit: 1000 })
      : [];

  const { data, error } = await admin.rpc("sync_stripe_payment", {
    p_state: paymentIntentState(intent, refunds) as unknown as Json,
  });
  if (error) {
    throw new Error(`sync_stripe_payment failed: ${error.code || "-"} ${error.message}`);
  }
  const result = data as unknown as SyncResult;

  // Paid after the order was cancelled (its stock already released): give
  // the money back. The idempotency key makes this happen once at Stripe.
  if (result.refund_required) {
    await stripe.refunds.create(
      {
        payment_intent: intent.id,
        reason: "requested_by_customer",
        metadata: {
          order_id: result.order_id ?? "",
          note: "Automatic refund: the order was cancelled before the payment arrived.",
        },
      },
      { idempotencyKey: `mirna-auto-refund-${intent.id}` },
    );
    console.warn(`[payments] order ${result.order_id} paid after cancellation: refunded`);
    return syncPaymentIntent(paymentIntentId);
  }
  return result;
}
