import "server-only";
import Stripe from "stripe";
import { stripeKeyMode } from "./rules";

/**
 * Stripe client for mirna-admin: webhooks, refunds, cancelling unpaid
 * payments and the payment settings checks. Server-only: the secret key is
 * read from STRIPE_SECRET_KEY (no NEXT_PUBLIC_ prefix, so it never reaches a
 * browser bundle). Returns null when it isn't configured.
 *
 * The API version is the one this SDK release is pinned to, so the types
 * match what Stripe returns.
 */
let client: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (client !== undefined) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  client = key
    ? new Stripe(key, {
        maxNetworkRetries: 2,
        timeout: 20_000,
        appInfo: { name: "mirna-admin" },
      })
    : null;
  return client;
}

/** "test" / "live" from the configured key (never the key itself). */
export function getStripeMode(): "live" | "test" | null {
  return stripeKeyMode(process.env.STRIPE_SECRET_KEY);
}

export function isStripeError(error: unknown): error is Stripe.errors.StripeError {
  return error instanceof Stripe.errors.StripeError;
}
