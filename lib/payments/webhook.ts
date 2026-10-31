import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPaymentIntent } from "./sync";

/**
 * Verified Stripe events (app/api/stripe/webhook/route.ts) → the database.
 *
 * Idempotent twice over: claim_payment_event() records every event id, so a
 * redelivery of an event already processed is acknowledged and skipped; and
 * processing re-reads the PaymentIntent from Stripe and applies its current
 * state, so two different events racing (or arriving out of order) end in
 * the same place. The event body itself is only used for the ids.
 *
 * A failure is recorded and answered with 500, so Stripe retries it.
 */

const PAYMENT_INTENT_EVENTS = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.processing",
  "payment_intent.canceled",
  "payment_intent.requires_action",
]);
const REFUND_EVENTS = new Set([
  "charge.refunded",
  "charge.refund.updated",
  "refund.created",
  "refund.updated",
  "refund.failed",
]);

export function isHandledEvent(type: string): boolean {
  return PAYMENT_INTENT_EVENTS.has(type) || REFUND_EVENTS.has(type);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** The PaymentIntent an event is about, if any. */
function paymentIntentOf(event: Stripe.Event): string | null {
  const object = event.data.object as {
    object?: string;
    id?: string;
    payment_intent?: string | { id: string } | null;
  };
  if (object.object === "payment_intent") return object.id ?? null;
  return idOf(object.payment_intent);
}

export type WebhookOutcome = "applied" | "ignored" | "duplicate" | "failed";

export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  if (!isHandledEvent(event.type)) return "ignored";

  const admin = createAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");

  const objectId = (event.data.object as { id?: string }).id ?? null;
  const { data: alreadyProcessed, error: claimError } = await admin.rpc("claim_payment_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_object_id: objectId,
    p_livemode: event.livemode,
    p_created_at: new Date(event.created * 1000).toISOString(),
  });
  if (claimError) {
    throw new Error(`claim_payment_event failed: ${claimError.code || "-"} ${claimError.message}`);
  }
  if (alreadyProcessed) return "duplicate";

  const paymentIntentId = paymentIntentOf(event);
  const finish = async (
    outcome: "applied" | "ignored" | "failed",
    orderId: string | null,
    detail: string | null,
  ) => {
    const { error } = await admin.rpc("finish_payment_event", {
      p_event_id: event.id,
      p_outcome: outcome,
      p_payment_intent_id: paymentIntentId,
      p_order_id: orderId,
      p_detail: detail,
    });
    if (error) console.error(`[payments] finish_payment_event failed: ${error.message}`);
  };

  if (!paymentIntentId) {
    await finish("ignored", null, "no_payment_intent");
    return "ignored";
  }

  try {
    const result = await syncPaymentIntent(paymentIntentId);
    await finish(
      result.outcome,
      result.order_id ?? null,
      result.detail ?? result.payment_status ?? null,
    );
    if (result.outcome === "ignored") {
      console.warn(
        `[payments] ${event.type} ${event.id} ignored: ${result.detail ?? "-"} (${paymentIntentId})`,
      );
    }
    return result.outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[payments] ${event.type} ${event.id} failed: ${message}`);
    await finish("failed", null, message);
    return "failed";
  }
}
