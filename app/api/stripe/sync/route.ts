import { timingSafeEqual } from "node:crypto";
import { getStripe, isStripeError } from "@/lib/payments/stripe";
import { PaymentsNotConfiguredError, syncPaymentIntent } from "@/lib/payments/sync";

/**
 * Server-to-server: the storefront asks for one PaymentIntent to be synced
 * right away (the customer is on the confirmation page and Stripe already
 * says it succeeded), instead of waiting for the webhook.
 *
 *   POST /api/stripe/sync
 *   Authorization: Bearer $PAYMENTS_SYNC_SECRET
 *   { "payment_intent_id": "pi_…" }
 *
 * Only an id is accepted: the PaymentIntent is re-read from Stripe and
 * applied by syncPaymentIntent() exactly like a webhook (order id, amount and
 * currency checked against the order), so nothing the caller says is
 * trusted. Idempotent; the webhook arriving later changes nothing.
 */

function authorized(request: Request): boolean {
  const secret = process.env.PAYMENTS_SYNC_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!getStripe()) return json({ ok: false, error: "not_configured" }, 503);

  let id: unknown;
  try {
    id = ((await request.json()) as { payment_intent_id?: unknown }).payment_intent_id;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }
  if (typeof id !== "string" || !/^pi_[A-Za-z0-9]+$/.test(id)) {
    return json({ ok: false, error: "invalid_payment_intent" }, 400);
  }

  try {
    const result = await syncPaymentIntent(id);
    return json({
      ok: true,
      outcome: result.outcome,
      detail: result.detail ?? null,
      order_id: result.order_id ?? null,
      payment_status: result.payment_status ?? null,
      order_status: result.order_status ?? null,
    });
  } catch (error) {
    if (error instanceof PaymentsNotConfiguredError) {
      return json({ ok: false, error: "not_configured" }, 503);
    }
    if (isStripeError(error) && error.code === "resource_missing") {
      return json({ ok: false, error: "not_found" }, 404);
    }
    console.error(
      `[payments] sync ${id} failed: ${error instanceof Error ? error.message : error}`,
    );
    return json({ ok: false, error: "sync_failed" }, 502);
  }
}
