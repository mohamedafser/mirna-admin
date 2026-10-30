"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  getStockAllocation,
  searchStockItems,
  type StockAllocation,
  type StockItem,
} from "./queries";
import {
  BATCH_MODES,
  isAdjustmentReason,
  isBatchMode,
  MAX_BATCH_LINES,
  NOTES_MAX_LENGTH,
  previewBatchLine,
  isAdjustmentType,
  parseThreshold,
  parseWholeNumber,
  validateAdjustment,
  type AdjustmentError,
  type AdjustmentReason,
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

export type InventoryFormError =
  "forbidden" | "notFound" | "conflict" | "network" | "unexpected" | "hasVariants";

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
  exceeds_pool: { field: "quantity", code: "exceedsPool" },
  below_allocated: { field: "quantity", code: "belowAllocated" },
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
  // Products with variants: stock is managed per variant (migration 024).
  if (code === "has_variants") return { ok: false, error: "hasVariants", fieldErrors: {} };
  console.error(`[inventory] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
  // Fetch failures surface with an empty code.
  return { ok: false, error: error.code ? "unexpected" : "network", fieldErrors: {} };
}

/**
 * Adjusts a product's stock, or one variant's when the form has a `variantId`
 * (adjust_variant_inventory(): same rules, same history table).
 */
export async function adjustStock(data: FormData): Promise<AdjustResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden", fieldErrors: {} };

  const productId = String(data.get("productId") ?? "");
  const variantId = String(data.get("variantId") ?? "");
  if (!isUuid(productId)) return { ok: false, error: "notFound", fieldErrors: {} };
  if (variantId && !isUuid(variantId)) return { ok: false, error: "notFound", fieldErrors: {} };
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
  const args = {
    p_type: input.type,
    p_quantity: parseWholeNumber(input.quantity) ?? 0,
    p_reason: input.reason,
    p_notes: input.notes.trim() || null,
    // "Set" must not overwrite a value someone else changed meanwhile.
    p_expected_quantity: input.type === "set" ? expected : null,
  };
  const { data: row, error } = variantId
    ? await supabase.rpc("adjust_variant_inventory", { p_variant_id: variantId, ...args })
    : await supabase.rpc("adjust_inventory", { p_product_id: productId, ...args });
  if (error) return mapError(error, "adjust stock");

  refresh();
  return { ok: true, quantity: row.quantity };
}

/** Product-level threshold, or one variant's when `variantId` is given. */
export async function updateLowStockThreshold(
  productId: string,
  raw: string,
  variantId?: string,
): Promise<InventoryActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(productId)) return { ok: false, error: "notFound" };
  if (variantId !== undefined && !isUuid(variantId)) return { ok: false, error: "notFound" };
  const threshold = parseThreshold(raw);
  if (!threshold.ok) return { ok: false, error: threshold.error };

  const supabase = await createClient();
  const update = { low_stock_threshold: threshold.value };
  const { data, error } = variantId
    ? await supabase
        .from("variant_inventory")
        .update(update)
        .eq("variant_id", variantId)
        .eq("product_id", productId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("inventory")
        .update(update)
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

/** Items for the Update stock page: a search, or everything low / out of stock. */
export async function findStockItems(q: string, attention = false): Promise<StockItem[]> {
  if (!(await getAdminOrNull())) return [];
  return searchStockItems(String(q ?? "").slice(0, 100), attention === true);
}

export interface BatchLineInput {
  productId: string;
  variantId: string | null;
  /** As typed: units received / removed, or the counted quantity. */
  quantity: string;
  /** On hand when the line was added: a count refuses to overwrite a newer value. */
  expected: number;
}

export type BatchResult =
  | { ok: true; count: number }
  | {
      ok: false;
      error?: InventoryFormError | "empty" | "tooMany" | "duplicate" | "nothingToChange";
      /** Errors by line index. */
      lineErrors?: Record<number, AdjustmentError | "conflict" | "hasVariants" | "notFound">;
      fieldErrors?: AdjustmentFieldErrors;
    };

/**
 * Applies one mode (receive / count / remove), reason and note to many items
 * in one transaction (adjust_stock_batch(), migration 041): every line is
 * saved, or none. Lines are re-validated here; current stock is re-checked in
 * the database.
 */
export async function adjustStockBatch(input: {
  mode: string;
  reason: string;
  notes: string;
  lines: BatchLineInput[];
}): Promise<BatchResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isBatchMode(input.mode)) return { ok: false, error: "unexpected" };
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return { ok: false, error: "empty" };
  if (lines.length > MAX_BATCH_LINES) return { ok: false, error: "tooMany" };

  const fieldErrors: AdjustmentFieldErrors = {};
  if (!isAdjustmentReason(input.reason)) fieldErrors.reason = "reasonRequired";
  const notes = String(input.notes ?? "").trim();
  if (notes.length > NOTES_MAX_LENGTH) fieldErrors.notes = "notesTooLong";
  else if (input.reason === "other" && !notes) fieldErrors.notes = "notesRequired";

  const lineErrors: Record<number, AdjustmentError | "notFound"> = {};
  const keys = new Set<string>();
  const items: Array<{
    product_id: string;
    variant_id: string | null;
    quantity: number;
    expected_quantity: number;
  }> = [];
  lines.forEach((line, index) => {
    if (!isUuid(line?.productId) || (line.variantId !== null && !isUuid(line.variantId))) {
      lineErrors[index] = "notFound";
      return;
    }
    const key = line.variantId ?? line.productId;
    if (keys.has(key)) return;
    keys.add(key);
    // Reserved is re-checked in the database; 0 here only checks the input.
    const preview = previewBatchLine(
      input.mode as keyof typeof BATCH_MODES,
      String(line.quantity),
      {
        quantity: line.expected,
        reserved: 0,
      },
    );
    if (preview.ok === false) lineErrors[index] = preview.error;
    else if (preview.ok === true) {
      items.push({
        product_id: line.productId,
        variant_id: line.variantId,
        quantity: parseWholeNumber(String(line.quantity)) ?? 0,
        expected_quantity: line.expected,
      });
    }
  });
  if (keys.size !== lines.length) return { ok: false, error: "duplicate" };
  if (Object.keys(fieldErrors).length > 0 || Object.keys(lineErrors).length > 0) {
    return { ok: false, fieldErrors, lineErrors };
  }
  if (items.length === 0) return { ok: false, error: "nothingToChange" };
  // Stock pools (migration 042): grow a product's pool before its variants
  // take from it, and shrink variants before their pool. Errors are mapped
  // back to lines by item, so the order here doesn't matter to the form.
  const poolFirst = BATCH_MODES[input.mode as keyof typeof BATCH_MODES].type !== "decrease";
  items.sort(
    (a, b) =>
      Number(a.variant_id === null ? !poolFirst : poolFirst) -
      Number(b.variant_id === null ? !poolFirst : poolFirst),
  );

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_stock_batch", {
    p_type: BATCH_MODES[input.mode].type,
    p_reason: input.reason as AdjustmentReason,
    p_notes: notes || null,
    p_items: items as unknown as Json,
  });
  if (error) {
    // "inventory:item:<index in items>:<code>" → that line.
    const match = /^inventory:item:(\d+):(\w+)$/.exec(error.message ?? "");
    if (match) {
      const sent = items[Number(match[1])];
      const index = lines.findIndex(
        (line) => (line.variantId ?? line.productId) === (sent?.variant_id ?? sent?.product_id),
      );
      const field = fieldCodes[match[2]];
      const code =
        field?.code ??
        (match[2] === "conflict" || match[2] === "40001"
          ? "conflict"
          : match[2] === "has_variants"
            ? "hasVariants"
            : match[2] === "not_found" || match[2] === "P0002"
              ? "notFound"
              : null);
      if (code && index >= 0) return { ok: false, lineErrors: { [index]: code } };
    }
    if (error.message === "inventory:duplicate") return { ok: false, error: "duplicate" };
    const mapped = mapError(error, "adjust stock batch");
    return { ok: false, error: mapped.error ?? "unexpected" };
  }
  refresh();
  return { ok: true, count: data ?? 0 };
}

/**
 * After a product is saved: its stock pool and variants when part of the pool
 * isn't shared out yet (the form then offers to do it), else null.
 */
export async function findUnallocatedStock(productId: string): Promise<StockAllocation | null> {
  if (!(await getAdminOrNull()) || !isUuid(productId)) return null;
  const allocation = await getStockAllocation(productId);
  return allocation && allocation.unallocated > 0 && allocation.variants.length > 0
    ? allocation
    : null;
}
