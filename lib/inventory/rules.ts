// Inventory business rules shared by the UI (instant feedback, previews) and
// the Server Actions. The database function adjust_inventory() (migration
// 015) enforces the same rules authoritatively inside a transaction.

import type { Enums } from "@/lib/supabase/database.types";
import { normalizeNumberInput } from "@/lib/money";

export type AdjustmentType = Enums<"inventory_adjustment_type">;
export type AdjustmentReason = Enums<"inventory_adjustment_reason">;
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock" | "unconfigured";

export const ADJUSTMENT_TYPES = [
  "increase",
  "decrease",
  "set",
] as const satisfies readonly AdjustmentType[];
export const ADJUSTMENT_REASONS = [
  "stock_received",
  "stock_count_correction",
  "damaged",
  "lost",
  "returned",
  "manual_correction",
  "other",
] as const satisfies readonly AdjustmentReason[];
export const STOCK_STATUSES = ["in_stock", "low_stock", "out_of_stock", "unconfigured"] as const;

export const NOTES_MAX_LENGTH = 500;
/** PostgreSQL integer maximum. */
export const QUANTITY_MAX = 2147483647;

export function isAdjustmentType(value: unknown): value is AdjustmentType {
  return (ADJUSTMENT_TYPES as readonly unknown[]).includes(value);
}
export function isAdjustmentReason(value: unknown): value is AdjustmentReason {
  return (ADJUSTMENT_REASONS as readonly unknown[]).includes(value);
}
export function isStockStatus(value: unknown): value is StockStatus {
  return (STOCK_STATUSES as readonly unknown[]).includes(value);
}

/** Same rule as the inventory_overview view: available = quantity - reserved. */
export function stockStatus(quantity: number, reserved: number, threshold: number): StockStatus {
  const available = quantity - reserved;
  if (available <= 0) return "out_of_stock";
  if (available <= threshold) return "low_stock";
  return "in_stock";
}

/** Whole number >= 0 (accepts Arabic-Indic digits); null if invalid. */
export function parseWholeNumber(raw: string): number | null {
  const value = normalizeNumberInput(raw.trim());
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= QUANTITY_MAX ? parsed : null;
}

export type AdjustmentError =
  | "quantityRequired"
  | "quantityInvalid"
  | "quantityZero"
  | "belowZero"
  | "belowReserved"
  | "tooLarge"
  | "noChange"
  | "exceedsPool"
  | "belowAllocated"
  | "reasonRequired"
  | "notesRequired"
  | "notesTooLong";

export interface AdjustmentInput {
  type: string;
  quantity: string;
  reason: string;
  notes: string;
}

export type AdjustmentFieldErrors = Partial<
  Record<"quantity" | "reason" | "notes", AdjustmentError>
>;

/**
 * Current stock of what's being adjusted, with the stock-pool limits
 * (migration 042): a product with variants can't go below what its variants
 * hold (`min`), and a variant can't go above its quantity + the pool's
 * unallocated units (`max`).
 */
export interface StockLevel {
  quantity: number;
  reserved: number;
  /** Product with variants: units its variants hold. */
  min?: number;
  /** Variant: the most it can hold within its product's pool. */
  max?: number | null;
}

/** New quantity and signed change for an adjustment, or the rule it breaks. */
export function previewAdjustment(
  type: AdjustmentType,
  amount: number,
  current: StockLevel,
): { ok: true; newQuantity: number; change: number } | { ok: false; error: AdjustmentError } {
  if (type !== "set" && amount === 0) return { ok: false, error: "quantityZero" };
  const newQuantity =
    type === "increase"
      ? current.quantity + amount
      : type === "decrease"
        ? current.quantity - amount
        : amount;
  if (newQuantity < 0) return { ok: false, error: "belowZero" };
  if (newQuantity < current.reserved) return { ok: false, error: "belowReserved" };
  if (current.min !== undefined && newQuantity < current.min) {
    return { ok: false, error: "belowAllocated" };
  }
  if (current.max != null && newQuantity > current.max && newQuantity > current.quantity) {
    return { ok: false, error: "exceedsPool" };
  }
  if (newQuantity > QUANTITY_MAX) return { ok: false, error: "tooLarge" };
  if (newQuantity === current.quantity) return { ok: false, error: "noChange" };
  return { ok: true, newQuantity, change: newQuantity - current.quantity };
}

export function validateAdjustment(
  input: AdjustmentInput,
  current?: StockLevel,
): AdjustmentFieldErrors {
  const errors: AdjustmentFieldErrors = {};
  const amount = input.quantity.trim() === "" ? null : parseWholeNumber(input.quantity);

  if (input.quantity.trim() === "") errors.quantity = "quantityRequired";
  else if (amount === null) errors.quantity = "quantityInvalid";
  else if (isAdjustmentType(input.type) && current) {
    const preview = previewAdjustment(input.type, amount, current);
    if (!preview.ok) errors.quantity = preview.error;
  }

  if (!isAdjustmentReason(input.reason)) errors.reason = "reasonRequired";
  const notes = input.notes.trim();
  if (notes.length > NOTES_MAX_LENGTH) errors.notes = "notesTooLong";
  else if (input.reason === "other" && !notes) errors.notes = "notesRequired";
  return errors;
}

export type ThresholdError = "thresholdRequired" | "thresholdInvalid";

export function parseThreshold(
  raw: string,
): { ok: true; value: number } | { ok: false; error: ThresholdError } {
  if (raw.trim() === "") return { ok: false, error: "thresholdRequired" };
  const value = parseWholeNumber(raw);
  return value === null ? { ok: false, error: "thresholdInvalid" } : { ok: true, value };
}

// ---------------------------------------------------------------------------
// Update stock (batch)
// ---------------------------------------------------------------------------

/** adjust_stock_batch() takes at most this many lines. */
export const MAX_BATCH_LINES = 200;

/**
 * What the Update stock page does, as an adjustment type and the reason it
 * suggests: receive a delivery (+), count stock (= the counted number), or
 * remove goods (−, damaged by default).
 */
export const BATCH_MODES = {
  receive: { type: "increase", reason: "stock_received" },
  count: { type: "set", reason: "stock_count_correction" },
  remove: { type: "decrease", reason: "damaged" },
} as const satisfies Record<string, { type: AdjustmentType; reason: AdjustmentReason }>;
export type BatchMode = keyof typeof BATCH_MODES;

export function isBatchMode(value: unknown): value is BatchMode {
  return typeof value === "string" && Object.hasOwn(BATCH_MODES, value);
}

/**
 * One batch line: the new on-hand quantity, "skip" for a count that matches
 * (nothing to change), or why it can't be applied.
 */
export function previewBatchLine(
  mode: BatchMode,
  raw: string,
  current: StockLevel,
):
  | { ok: true; newQuantity: number; change: number }
  | { ok: "skip" }
  | { ok: false; error: AdjustmentError } {
  if (raw.trim() === "") return { ok: false, error: "quantityRequired" };
  const amount = parseWholeNumber(raw);
  if (amount === null) return { ok: false, error: "quantityInvalid" };
  const type = BATCH_MODES[mode].type;
  if (type === "set" && amount === current.quantity) return { ok: "skip" };
  return previewAdjustment(type, amount, current);
}
