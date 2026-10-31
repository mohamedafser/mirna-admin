import { timingSafeEqual } from "node:crypto";
import { cancelUnpaidOrder } from "@/lib/payments/orders";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Releases the stock of unpaid orders past their payment deadline
 * (Payments → "Payment window"). Call it every few minutes from a scheduler
 * (e.g. Vercel Cron, GitHub Actions, cron-job.org):
 *
 *   GET /api/stripe/expire-orders
 *   Authorization: Bearer $CRON_SECRET
 *
 * Each order's PaymentIntent is cancelled at Stripe before the order is
 * cancelled (lib/payments/orders.ts), so a late payment can't land on a
 * cancelled order. Safe to call concurrently and repeatedly.
 */

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createAdminClient();
  if (!admin) return json({ ok: false, error: "not_configured" }, 503);

  const { data: orders, error } = await admin.rpc("expired_unpaid_orders", { p_limit: 50 });
  if (error) {
    console.error(`[payments] expired_unpaid_orders failed: ${error.message}`);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }

  const results: Record<string, number> = {};
  for (const order of orders) {
    try {
      const result = await cancelUnpaidOrder(order.order_id);
      results[result] = (results[result] ?? 0) + 1;
      if (result === "cancelled") {
        console.info(`[payments] order #${order.order_number} expired unpaid: cancelled`);
      }
    } catch (cancelError) {
      results.error = (results.error ?? 0) + 1;
      console.error(
        `[payments] expiring order #${order.order_number} failed: ${cancelError instanceof Error ? cancelError.message : cancelError}`,
      );
    }
  }
  return json({ ok: true, checked: orders.length, results });
}
