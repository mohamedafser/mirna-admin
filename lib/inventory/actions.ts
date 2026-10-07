"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { createClient } from "@/lib/supabase/server";
import {
  isAdjustmentReason,
  isAdjustmentType,
  parseThreshold,
  parseWholeNumber,
  validateAdjustment,
  type AdjustmentError,
  type AdjustmentFieldErrors,
  type ThresholdError,
} from "./rules";

/**
 * Inventory mutations. Each action re-checks the admin session, validates,
 * then calls the database, which is authoritative:
 *  - stock changes go through adjust_inventory() (row lock + validation +
 *    update + history in one transaction; the admin is auth.uid()),
 *  - the threshold is the only column admins may update directly (RLS).
 * There are no optimistic updates: success is reported only after the
 * database committed, then refresh() re-renders with the stored values.
 */

export type InventoryFormError = "forbidden" | "notFound" | "conflict" | "network" | "unexpected";

export type AdjustResult =
  | { ok: true; quantity: number }
  | { ok: false; error?: InventoryFormError; fieldErrors: AdjustmentFieldErrors };

export type InventoryActionResult =
  { ok: true; count?: number } | { ok: false; error: InventoryFormError | ThresholdError };

/** Maps adjust_inventory() errors ("inventory:<code>") to safe codes. */
const fieldCodes: Record<string, { field: keyof AdjustmentFieldErrors; code: AdjustmentError }> = {
  invalid_quantity: { field: "quantity", code: "quantityInvalid" },
  below_zero: { field: "quantity", code: "belowZero" },
  below_reserved: { field: "quantity", code: "belowReserved" },
  too_large: { field: "quantity", code: "tooLarge" },
  no_change: { field: "quantity", code: "noChange" },
  notes_required: { field: "notes", code: "notesRequired" },
  notes_too_long: { field: "notes", code: "notesTooLong" },
};

function mapError(error: PostgrestError, scope: string): AdjustResult & { ok: false } {
  const code = error.message?.startsWith("inventory:") ? error.message.slice(10) : "";
  const field = fieldCodes[code];
  if (field) return { ok: false, fieldErrors: { [field.field]: field.code } };
  if (code === "conflict" || error.code === "40001")
    return { ok: false, error: "conflict", fieldErrors: {} };
  if (code === "not_found" || error.code === "P0002")
    return { ok: false, error: "notFound", fieldErrors: {} };
  if (code === "forbidden" || error.code === "42501")
    return { ok: false, error: "forbidden", fieldErrors: {} };
  console.error(`[inventory] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
  // Fetch failures surface with an empty code.
  return { ok: false, error: error.code ? "unexpected" : "network", fieldErrors: {} };
}

export async function adjustStock(data: FormData): Promise<AdjustResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden", fieldErrors: {} };

  const productId = String(data.get("productId") ?? "");
  if (!isUuid(productId)) return { ok: false, error: "notFound", fieldErrors: {} };
  const input = {
    type: String(data.get("type") ?? ""),
    quantity: String(data.get("quantity") ?? ""),
    reason: String(data.get("reason") ?? ""),
    notes: String(data.get("notes") ?? ""),
  };
  // Current values are re-read and checked in the database; here only the
  // input itself is validated.
  const fieldErrors = validateAdjustment(input);
  if (!isAdjustmentType(input.type)) return { ok: false, error: "unexpected", fieldErrors };
  if (Object.keys(fieldErrors).length > 0 || !isAdjustmentReason(input.reason)) {
    return { ok: false, fieldErrors };
  }

  const expected = parseWholeNumber(String(data.get("expectedQuantity") ?? ""));
  const supabase = await createClient();
  const { data: row, error } = await supabase.rpc("adjust_inventory", {
    p_product_id: productId,
    p_type: input.type,
    p_quantity: parseWholeNumber(input.quantity) ?? 0,
    p_reason: input.reason,
    p_notes: input.notes.trim() || null,
    // "Set" must not overwrite a value someone else changed meanwhile.
    p_expected_quantity: input.type === "set" ? expected : null,
  });
  if (error) return mapError(error, "adjust stock");

  refresh();
  return { ok: true, quantity: row.quantity };
}

export async function updateLowStockThreshold(
  productId: string,
  raw: string,
): Promise<InventoryActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(productId)) return { ok: false, error: "notFound" };
  const threshold = parseThreshold(raw);
  if (!threshold.ok) return { ok: false, error: threshold.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory")
    .update({ low_stock_threshold: threshold.value })
    .eq("product_id", productId)
    .select("id")
    .maybeSingle();
  if (error) {
    const mapped = mapError(error, "update threshold");
    return { ok: false, error: mapped.error ?? "unexpected" };
  }
  if (!data) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

/** Creates missing inventory rows: one product, or every product when omitted. */
export async function initializeInventory(productId?: string): Promise<InventoryActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (productId !== undefined && !isUuid(productId)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("initialize_inventory", {
    p_product_id: productId ?? null,
  });
  if (error) {
    const mapped = mapError(error, "initialize inventory");
    return { ok: false, error: mapped.error ?? "unexpected" };
  }
  refresh();
  return { ok: true, count: data };
}
