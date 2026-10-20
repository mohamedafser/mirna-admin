"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import type { ActionResult, CatalogueFormError } from "@/lib/catalogue/actions";
import { isUuid } from "@/lib/catalogue/validation";
import { parseMoney } from "@/lib/money";
import { isCurrencyCode } from "@/lib/settings/rules";
import { createClient } from "@/lib/supabase/server";
import { loadVariantAxes } from "./queries";
import {
  combinationKey,
  combinations,
  MAX_VARIANTS_PER_CALL,
  readVariant,
  suggestSku,
  validateVariant,
  type VariantFieldErrors,
} from "./rules";

/**
 * Variant mutations. Same contract as the catalogue actions: re-check the
 * admin, validate with the form rules, write through the caller's session
 * (RLS, grants, constraints and triggers are final), map database errors to
 * safe codes. Stock changes go through lib/inventory/actions.ts.
 */

export type VariantError =
  | CatalogueFormError
  | "noOptions"
  | "invalidCombination"
  | "combinationExists"
  | "skuTaken"
  | "stockTargetRequired"
  | "productReserved"
  | "tooMany"
  | "hasStock"
  | "hasHistory"
  | "hasReserved";

export type GenerateResult = { ok: true; count: number } | { ok: false; error: VariantError };

export interface VariantFormResult {
  status: "idle" | "success" | "error";
  error?: VariantError;
  fieldErrors: VariantFieldErrors;
  at: number;
}

function log(scope: string, error: { code?: string; message?: string }) {
  console.error(`[variants] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
}

/** Maps database errors (variant:<code>, constraints) to safe codes. */
function mapError(error: PostgrestError, scope: string): VariantError {
  const text = `${error.message} ${error.details ?? ""}`;
  const code = error.message?.startsWith("variant:") ? error.message.slice(8) : "";
  const codes: Record<string, VariantError> = {
    forbidden: "forbidden",
    not_found: "notFound",
    no_options: "noOptions",
    invalid_combination: "invalidCombination",
    stock_target_required: "stockTargetRequired",
    product_reserved: "productReserved",
    too_many: "tooMany",
    has_stock: "hasStock",
  };
  if (codes[code]) return codes[code];
  if (error.code === "23505") {
    if (text.includes("combination_key")) return "combinationExists";
    if (text.includes("sku")) return "skuTaken";
  }
  if (error.code === "23503" && text.includes("inventory_adjustments")) return "hasHistory";
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0002") return "notFound";
  log(scope, error);
  return error.code ? "unexpected" : "network";
}

/**
 * Creates variants for the chosen combinations (keys from the generator).
 * Combinations are re-derived here from the product's current options, so
 * the client can only pick, never invent, one. SKUs are suggested from the
 * product SKU and value names, skipping every SKU already in use. Existing
 * variants are never touched; the database refuses duplicates.
 */
export async function generateVariants(
  productId: string,
  keys: string[],
  stockTargetKey: string | null,
): Promise<GenerateResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(productId)) return { ok: false, error: "notFound" };
  if (keys.length === 0) return { ok: false, error: "invalidCombination" };
  if (keys.length > MAX_VARIANTS_PER_CALL) return { ok: false, error: "tooMany" };

  const supabase = await createClient();
  const [axes, product, existing] = await Promise.all([
    loadVariantAxes(supabase, productId),
    supabase.from("products").select("sku").eq("id", productId).maybeSingle(),
    supabase.from("product_variants").select("combination_key").eq("product_id", productId),
  ]);
  if (product.error) return { ok: false, error: mapError(product.error, "read product") };
  if (existing.error) return { ok: false, error: mapError(existing.error, "read variants") };
  if (!product.data) return { ok: false, error: "notFound" };
  if (axes.length === 0) return { ok: false, error: "noOptions" };

  const all = new Map(combinations(axes).map((combination) => [combination.key, combination]));
  const wanted = [...new Set(keys.map((key) => combinationKey(key.split(","))))];
  const chosen = wanted.map((key) => all.get(key));
  if (chosen.some((combination) => !combination)) return { ok: false, error: "invalidCombination" };
  const used = new Set(existing.data.map((variant) => variant.combination_key));
  if (wanted.some((key) => used.has(key))) return { ok: false, error: "combinationExists" };

  // SKUs already taken (products and variants starting with the product SKU).
  const prefix = product.data.sku.replace(/[%_\\]/g, "\\$&");
  const [takenVariants, takenProducts] = await Promise.all([
    supabase.from("product_variants").select("sku").ilike("sku", `${prefix}-%`),
    supabase.from("products").select("sku").ilike("sku", `${prefix}-%`),
  ]);
  const takenError = takenVariants.error ?? takenProducts.error;
  if (takenError) return { ok: false, error: mapError(takenError, "read skus") };
  const taken = new Set(
    [...(takenVariants.data ?? []), ...(takenProducts.data ?? [])].map((row) =>
      row.sku.toUpperCase(),
    ),
  );
  taken.add(product.data.sku.toUpperCase());

  const variants = chosen.map((combination) => ({
    value_ids: combination!.valueIds,
    sku: suggestSku(product.data!.sku, combination!, axes, taken),
  }));
  const target = stockTargetKey ? wanted.indexOf(combinationKey(stockTargetKey.split(","))) : -1;

  const { data, error } = await supabase.rpc("generate_product_variants", {
    p_product_id: productId,
    p_variants: variants,
    p_stock_variant: target >= 0 ? target : null,
  });
  if (error) return { ok: false, error: mapError(error, "generate variants") };
  refresh();
  return { ok: true, count: data };
}

/** Edits one variant's SKU, price, compare-at price, image and status. */
export async function saveVariant(
  _prev: VariantFormResult,
  data: FormData,
): Promise<VariantFormResult> {
  const failure = (error: VariantError, fieldErrors: VariantFieldErrors = {}) => ({
    status: "error" as const,
    error,
    fieldErrors,
    at: Date.now(),
  });
  if (!(await getAdminOrNull())) return failure("forbidden");

  const id = String(data.get("id") ?? "");
  const version = String(data.get("updatedAt") ?? "");
  if (!isUuid(id)) return failure("notFound");
  const input = readVariant(data);

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("product_variants")
    .select("updated_at, product:products(currency_code)")
    .eq("id", id)
    .maybeSingle();
  if (readError) return failure(mapError(readError, "read variant"));
  if (!current?.product) return failure("notFound");
  if (current.updated_at !== version) return failure("conflict");

  const currency = current.product.currency_code;
  const fieldErrors = validateVariant(input, currency);
  if (Object.keys(fieldErrors).length > 0 || !isCurrencyCode(currency)) {
    return { status: "error", fieldErrors, at: Date.now() };
  }
  const price = parseMoney(input.price, currency);
  const compareAt = input.compareAtPrice ? parseMoney(input.compareAtPrice, currency) : null;

  const { data: updated, error } = await supabase
    .from("product_variants")
    .update({
      sku: input.sku,
      // Exact decimal strings (never floats) for NUMERIC columns.
      price: (price.ok ? price.value : "0") as unknown as number,
      compare_at_price: (compareAt?.ok ? compareAt.value : null) as unknown as number | null,
      image_id: input.imageId || null,
      is_active: input.isActive,
    })
    .eq("id", id)
    .eq("updated_at", version)
    .select("id")
    .maybeSingle();
  if (error) {
    const mapped = mapError(error, "update variant");
    if (mapped === "skuTaken") return failure("skuTaken", { sku: "skuTaken" });
    if (error.code === "23514" && error.message.includes("compare_at")) {
      return failure("unexpected", { compareAtPrice: "compareAtNotHigher" });
    }
    if (error.code === "23503") return failure("unexpected", { imageId: "imageInvalid" });
    return failure(mapped);
  }
  if (!updated) return failure("conflict");
  refresh();
  return { status: "success", fieldErrors: {}, at: Date.now() };
}

export async function setVariantActive(id: string, active: boolean): Promise<ActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(id)) return { ok: false, error: "notFound" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .update({ is_active: active })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    const mapped = mapError(error, "set variant status");
    return {
      ok: false,
      error: mapped === "forbidden" || mapped === "network" ? mapped : "unexpected",
    };
  }
  if (!data) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

/**
 * Deletes one variant. Any stock it has is cleared to 0 first (recorded in
 * its history, which is kept); variants with reserved units are refused.
 */
export async function deleteVariant(
  id: string,
): Promise<{ ok: true } | { ok: false; error: VariantError }> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(id)) return { ok: false, error: "notFound" };
  const supabase = await createClient();
  const { data: variant, error: readError } = await supabase
    .from("product_variants")
    .select("product_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: mapError(readError, "read variant") };
  if (!variant) return { ok: false, error: "notFound" };
  const result = await deleteVariants(variant.product_id, [id]);
  if (!result.ok) return result;
  if (result.deleted === 0) return { ok: false, error: "hasReserved" };
  return { ok: true };
}

/**
 * Deletes several of a product's variants (bulk selection) in one
 * transaction. Stock is cleared to 0 first (recorded in history, which is
 * kept under the variant's SKU); variants with reserved units are skipped.
 */
export async function deleteVariants(
  productId: string,
  ids: string[],
): Promise<{ ok: true; deleted: number; skipped: number } | { ok: false; error: VariantError }> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  const unique = [...new Set(ids)];
  if (!isUuid(productId) || unique.length === 0 || !unique.every(isUuid)) {
    return { ok: false, error: "notFound" };
  }
  if (unique.length > MAX_VARIANTS_PER_CALL) return { ok: false, error: "tooMany" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_product_variants", {
    p_product_id: productId,
    p_variant_ids: unique,
    p_clear_stock: true,
  });
  if (error) return { ok: false, error: mapError(error, "delete variants") };
  const { deleted, skipped } = data as { deleted: number; skipped: number };
  refresh();
  return { ok: true, deleted, skipped };
}
