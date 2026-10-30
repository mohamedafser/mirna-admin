// Variant rules shared by the variant screens (instant feedback) and the
// Server Actions. The database (migration 024: constraints, triggers,
// generate_product_variants() and adjust_variant_inventory()) is final.

import { isUuid, SKU_PATTERN } from "@/lib/catalogue/validation";
import { parseMoney, type MoneyError } from "@/lib/money";
import { isCurrencyCode } from "@/lib/settings/rules";
import { parseOptionalWeight, type WeightError } from "@/lib/shipping/rules";

/** Same cap as generate_product_variants(). */
export const MAX_VARIANTS_PER_CALL = 500;
export const SKU_MAX_LENGTH = 64;

/**
 * One variant option of a product: a multi-value SELECT / COLOR attribute and
 * the values selected on the product (migration 023), in display order.
 */
export interface VariantAxis {
  attributeId: string;
  name: string;
  values: Array<{ id: string; value: string; colorHex: string | null }>;
}

export interface Combination {
  /** Attribute value ids, one per axis, in axis order. */
  valueIds: string[];
  /** Sorted ids joined with "," — the same key the database stores. */
  key: string;
  /** "M / Red", in axis order. */
  label: string;
}

/** Same as product_variants.combination_key (ids sorted, comma-joined). */
export function combinationKey(valueIds: string[]): string {
  return [...valueIds]
    .map((id) => id.toLowerCase())
    .sort()
    .join(",");
}

/** Every combination of one value per axis (cartesian product), capped. */
export function combinations(axes: VariantAxis[], limit = 2000): Combination[] {
  if (axes.length === 0 || axes.some((axis) => axis.values.length === 0)) return [];
  let rows: Array<{ ids: string[]; names: string[] }> = [{ ids: [], names: [] }];
  for (const axis of axes) {
    const next: typeof rows = [];
    for (const row of rows) {
      for (const value of axis.values) {
        if (next.length >= limit) break;
        next.push({ ids: [...row.ids, value.id], names: [...row.names, value.value] });
      }
    }
    rows = next;
  }
  return rows.map((row) => ({
    valueIds: row.ids,
    key: combinationKey(row.ids),
    label: row.names.join(" / "),
  }));
}

/** SKU-safe part of a value name ("X Large" → "XLARGE"); "" for non-Latin text. */
function skuPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
}

/**
 * Suggested SKU: product SKU + one part per value ("MIR-001-M-RED"). Values
 * without Latin letters/digits use their position (1-based) instead.
 * `taken` (upper-cased) is checked so suggestions never collide; a numeric
 * suffix is added when needed. Always matches SKU_PATTERN.
 */
export function suggestSku(
  productSku: string,
  combination: Combination,
  axes: VariantAxis[],
  taken: Set<string>,
): string {
  const parts = combination.valueIds.map((id, index) => {
    const position = axes[index]?.values.findIndex((value) => value.id === id) ?? -1;
    const name = axes[index]?.values[position]?.value ?? "";
    return skuPart(name) || String(position + 1);
  });
  const suffix = `-${parts.join("-")}`;
  const base = `${productSku.slice(0, Math.max(1, SKU_MAX_LENGTH - suffix.length))}${suffix}`.slice(
    0,
    SKU_MAX_LENGTH,
  );
  let candidate = base;
  for (let n = 2; taken.has(candidate.toUpperCase()); n += 1) {
    const extra = `-${n}`;
    candidate = `${base.slice(0, SKU_MAX_LENGTH - extra.length)}${extra}`;
  }
  taken.add(candidate.toUpperCase());
  return candidate;
}

// ---------------------------------------------------------------------------
// Editing one variant
// ---------------------------------------------------------------------------

export type VariantFieldError =
  | "skuRequired"
  | "skuInvalid"
  | "skuTaken"
  | "compareAtNotHigher"
  | "imageInvalid"
  | MoneyError
  | WeightError;

export interface VariantInput {
  sku: string;
  price: string;
  compareAtPrice: string;
  /** "" = no image (falls back to the product's images). */
  imageId: string;
  isActive: boolean;
  /** Weight in kg ("" = the product's); null when the form has no weight field. */
  weight: string | null;
}

export type VariantFieldErrors = Partial<Record<keyof VariantInput, VariantFieldError>>;

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

export function readVariant(data: FormData): VariantInput {
  return {
    sku: text(data, "sku"),
    price: text(data, "price"),
    compareAtPrice: text(data, "compareAtPrice"),
    imageId: text(data, "imageId"),
    isActive: data.get("isActive") === "on",
    weight: data.has("weight") ? text(data, "weight") : null,
  };
}

/** `currency` is the product's currency (variants are priced in it). */
export function validateVariant(input: VariantInput, currency: string): VariantFieldErrors {
  const errors: VariantFieldErrors = {};
  if (!input.sku) errors.sku = "skuRequired";
  else if (!SKU_PATTERN.test(input.sku)) errors.sku = "skuInvalid";
  if (input.imageId && !isUuid(input.imageId)) errors.imageId = "imageInvalid";
  if (input.weight != null) {
    const weight = parseOptionalWeight(input.weight);
    if (!weight.ok) errors.weight = weight.error;
  }
  if (!isCurrencyCode(currency)) return errors;

  const price = parseMoney(input.price, currency);
  if (!price.ok) errors.price = price.error;
  if (input.compareAtPrice) {
    const compareAt = parseMoney(input.compareAtPrice, currency);
    if (!compareAt.ok) errors.compareAtPrice = compareAt.error;
    // Matches CHECK product_variants_compare_at_price_gt_price.
    else if (price.ok && compareAt.minor <= price.minor) {
      errors.compareAtPrice = "compareAtNotHigher";
    }
  }
  return errors;
}
