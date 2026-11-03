import { isCronRequest } from "@/lib/auth/cron";
import { deliverOrderEmails } from "@/lib/notifications/delivery";

/**
 * Sends waiting order status emails: orders placed on the storefront, and
 * retries after a mail failure. Call it every minute from a scheduler:
 *
 *   GET /api/orders/notifications
 *   Authorization: Bearer $CRON_SECRET
 *
 * Safe to call concurrently and repeatedly: each email is claimed by one run.
 */
const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!isCronRequest(request)) return json({ ok: false, error: "unauthorized" }, 401);

  const { configured, ...counts } = await deliverOrderEmails();
  if (!configured) return json({ ok: false, error: "not_configured" }, 503);
  return json({ ok: true, ...counts });
}
