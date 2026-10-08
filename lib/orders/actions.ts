"use server";

import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { createClient } from "@/lib/supabase/server";
import { canTransition, isOrderStatus } from "./rules";

export type OrderActionError =
  "forbidden" | "notFound" | "invalidTransition" | "conflict" | "network" | "unexpected";

export type OrderActionResult = { ok: true } | { ok: false; error: OrderActionError };

/**
 * Moves an order to its next status. Re-checks the admin session, validates
 * the move against the workflow, then updates with the admin's own session:
 * RLS (orders_update_admin) allows admins only, the column grant allows only
 * `status`, and the orders_guard_status trigger rejects invalid moves.
 * `from` is the status the admin was looking at: if someone else changed the
 * order meanwhile, nothing is updated ("conflict"). updated_at is set by the
 * orders_set_updated_at trigger. Prices and items are never touched.
 */
export async function updateOrderStatus(
  orderId: unknown,
  from: unknown,
  to: unknown,
): Promise<OrderActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(orderId)) return { ok: false, error: "notFound" };
  if (!isOrderStatus(from) || !isOrderStatus(to) || !canTransition(from, to)) {
    return { ok: false, error: "invalidTransition" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.message === "orders:invalid_transition") {
      return { ok: false, error: "invalidTransition" };
    }
    console.error(
      `[orders] update status failed: code=${error.code || "-"} message=${error.message || "-"}`,
    );
    // Fetch failures surface with an empty code.
    return { ok: false, error: error.code ? "unexpected" : "network" };
  }
  if (!data) {
    // Missing, or no longer in `from` (changed by someone else).
    const { data: exists } = await supabase
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .maybeSingle();
    return { ok: false, error: exists ? "conflict" : "notFound" };
  }

  refresh();
  return { ok: true };
}
