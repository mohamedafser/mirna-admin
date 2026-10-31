import { getAdminOrNull } from "@/lib/auth/dal";
import { countNewOrders } from "@/lib/orders/queries";

/**
 * GET /api/admin/new-orders → { ok: true, count } — orders waiting on the
 * store, for the sidebar badge (components/layout/new-orders-badge.tsx).
 * Active admins only (RLS checks again); never cached.
 */
const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  if (!(await getAdminOrNull())) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    return json({ ok: true, count: await countNewOrders() });
  } catch {
    return json({ ok: false, error: "unavailable" }, 503);
  }
}
