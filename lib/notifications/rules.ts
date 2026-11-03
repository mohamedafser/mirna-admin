/**
 * Delivery rules for order emails (order_notifications, migration 045). No
 * dependencies, so they can be unit tested.
 */

export const MAX_ATTEMPTS = 5;

/** Wait before the next try, after attempt 1, 2, 3, 4. */
const RETRY_MINUTES = [1, 5, 15, 60];

/** Older than this, an email is no use: its status is long out of date. */
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export type RetryDecision = { state: "PENDING"; nextAttemptAt: string } | { state: "FAILED" };

export function afterFailure(attempts: number, now = new Date()): RetryDecision {
  if (attempts >= MAX_ATTEMPTS) return { state: "FAILED" };
  const minutes = RETRY_MINUTES[Math.max(attempts, 1) - 1] ?? RETRY_MINUTES.at(-1)!;
  return {
    state: "PENDING",
    nextAttemptAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
  };
}

/**
 * True when the email waited too long (SMTP was down or not configured), so
 * customers don't get a burst of outdated updates once it's back.
 */
export function isStale(createdAt: string, now = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() > STALE_AFTER_MS;
}

/**
 * A reason safe to log and store: codes only. SMTP and database messages can
 * quote the recipient's address or server details, so `message` is never used.
 */
export function describeError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const { code, responseCode, command, name } = error as Record<string, unknown>;
  const safe = (value: unknown) =>
    (typeof value === "string" && /^[\w.-]{1,40}$/.test(value)) || typeof value === "number"
      ? String(value)
      : null;
  const parts = [safe(code), safe(responseCode), safe(command)].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : (safe(name) ?? "unknown");
}
