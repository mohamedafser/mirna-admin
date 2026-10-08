"use server";

import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { createClient } from "@/lib/supabase/server";

export type CustomerActionError = "forbidden" | "notFound" | "self" | "network" | "unexpected";

export type CustomerActionResult = { ok: true } | { ok: false; error: CustomerActionError };

/**
 * Activates or deactivates a customer account (profiles.is_active only).
 * Re-checks the admin session, then updates with the admin's own session, so
 * the database decides too: RLS (profiles_update_own_or_admin), the column
 * grant, and profiles_guard_update (admins only, never their own row). The
 * role filter keeps this action to CUSTOMER accounts; admins are managed on
 * the Admins page. Supabase Auth users are not touched. An inactive customer
 * can't place orders (place_order() checks is_active).
 */
export async function setCustomerActive(
  customerId: unknown,
  active: unknown,
): Promise<CustomerActionResult> {
  const admin = await getAdminOrNull();
  if (!admin) return { ok: false, error: "forbidden" };
  if (!isUuid(customerId) || typeof active !== "boolean") return { ok: false, error: "notFound" };
  if (customerId === admin.id) return { ok: false, error: "self" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", customerId)
    .eq("role", "CUSTOMER")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(
      `[customers] set status failed: code=${error.code || "-"} message=${error.message || "-"}`,
    );
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    // Fetch failures surface with an empty code.
    return { ok: false, error: error.code ? "unexpected" : "network" };
  }
  if (!data) return { ok: false, error: "notFound" };

  refresh();
  return { ok: true };
}
