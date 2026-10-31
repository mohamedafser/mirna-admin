// Online payment rules (migration 044), shared by the order pages, the refund
// dialog, the payment settings and the Server Actions. The database enforces
// the same rules, so it is authoritative. Self-contained (no imports), so
// `node --test` runs its tests directly.

export const PAYMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUSES = [
  "PENDING",
  "REQUIRES_ACTION",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Reasons an admin can give Stripe for a refund. */
export const REFUND_REASONS = ["requested_by_customer", "duplicate", "fraudulent"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isRefundReason(value: unknown): value is RefundReason {
  return typeof value === "string" && (REFUND_REASONS as readonly string[]).includes(value);
}

/** Money was taken (some of it may have been refunded since). */
export function isCaptured(status: PaymentStatus | null): boolean {
  return status === "PAID" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED";
}

/** A PaymentIntent that may still be paid (cancel it at Stripe before the order). */
export function isOpen(status: PaymentStatus | null): boolean {
  return status === "PENDING" || status === "PROCESSING" || status === "FAILED";
}

/**
 * What can still be refunded, in minor units: the amount received minus every
 * refund that hasn't failed or been cancelled (pending ones included, so two
 * admins can't refund the same money twice).
 */
export function refundableMinor(
  receivedMinor: bigint,
  refunds: readonly { amountMinor: bigint; status: RefundStatus }[],
): bigint {
  const committed = refunds
    .filter((refund) => refund.status !== "FAILED" && refund.status !== "CANCELLED")
    .reduce((sum, refund) => sum + refund.amountMinor, BigInt(0));
  const left = receivedMinor - committed;
  return left > BigInt(0) ? left : BigInt(0);
}

/**
 * Stripe's minor units per currency (docs.stripe.com/currencies). Charging
 * needs the store's currency decimals (currencies.decimals) to agree, or the
 * amount sent would be off by a factor of ten.
 */
const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

export function stripeDecimals(currencyCode: string): number {
  const code = currencyCode.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export function decimalsMatchStripe(currencyCode: string, decimals: number): boolean {
  return stripeDecimals(currencyCode) === decimals;
}

/** "sk_live_…" / "rk_live_…" → live; test keys → test; anything else → null. */
export function stripeKeyMode(key: string | undefined): "live" | "test" | null {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}

/** Normalises a domain for Stripe's payment method domains ("https://Shop.x.com/" → "shop.x.com"). */
export function normalizeDomain(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  let host = value;
  try {
    host = new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
  // A public host name: labels of letters, digits and hyphens, with a TLD.
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}

export const PAYMENT_WINDOW_MINUTES = { min: 15, max: 1440 } as const;

export function parsePaymentWindow(raw: string): number | null {
  if (!/^\d{1,4}$/.test(raw.trim())) return null;
  const minutes = Number(raw.trim());
  return minutes >= PAYMENT_WINDOW_MINUTES.min && minutes <= PAYMENT_WINDOW_MINUTES.max
    ? minutes
    : null;
}
