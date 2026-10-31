import { handleStripeEvent } from "@/lib/payments/webhook";
import { getStripe, isStripeError } from "@/lib/payments/stripe";

/**
 * Stripe webhook endpoint: https://<admin host>/api/stripe/webhook
 * (Stripe Dashboard → Developers → Webhooks; events listed in README).
 *
 * The signature is verified against the RAW body (request.text(), never a
 * parsed and re-serialised JSON) with STRIPE_WEBHOOK_SECRET. Anything that
 * doesn't verify is rejected before it touches the database. proxy.ts skips
 * /api, so there are no locale redirects or session cookies here.
 *
 * 200: processed, a duplicate, or an event we don't use. 500: processing
 * failed and Stripe should retry (it does, with backoff, for up to 3 days).
 */
const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    console.error(
      "[payments] webhook received but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing",
    );
    return json({ received: false, error: "not_configured" }, 503);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ received: false, error: "missing_signature" }, 400);

  const body = await request.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch (error) {
    console.warn(
      `[payments] webhook signature rejected: ${isStripeError(error) ? error.message : "invalid payload"}`,
    );
    return json({ received: false, error: "invalid_signature" }, 400);
  }

  try {
    const outcome = await handleStripeEvent(event);
    if (outcome === "failed") return json({ received: false, error: "processing_failed" }, 500);
    return json({ received: true, outcome });
  } catch (error) {
    console.error(
      `[payments] webhook ${event.type} ${event.id} error: ${error instanceof Error ? error.message : error}`,
    );
    return json({ received: false, error: "processing_failed" }, 500);
  }
}
