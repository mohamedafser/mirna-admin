// Catalogue form rules, shared by the client forms (instant feedback) and the
// Server Actions (authoritative). The database constraints (migrations 004–006)
// remain the final protection.

import { parseWholeNumber } from "@/lib/inventory/rules";
import { isCurrencyCode } from "@/lib/settings/rules";
import { parseMoney, type MoneyError } from "@/lib/money";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./slug";

export const NAME_MAX_LENGTH = 200;
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 5000;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 20000;
export const SHORT_DESCRIPTION_MAX_LENGTH = 500;
/** Same rule as the products.sku CHECK constraint. */
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SKU_MAX_LENGTH = 64;
const INT_MAX = 2147483647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CatalogueFieldError =
  | "nameRequired"
  | "nameTooLong"
  | "slugRequired"
  | "slugInvalid"
  | "slugTaken"
  | "skuRequired"
  | "skuInvalid"
  | "skuTaken"
  | "categoryRequired"
  | "categoryInvalid"
  | "categoryInactive"
  | "descriptionTooLong"
  | "shortDescriptionTooLong"
  | "sortOrderInvalid"
  | "currencyInvalid"
  | "compareAtNotHigher"
  | "stockRequired"
  | "stockInvalid"
  | "stockBelowReserved"
  | "thresholdRequired"
  | "thresholdInvalid"
  | "imageType"
  | "imageSize"
  | "imageEmpty"
  | MoneyError;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

function validateName(name: string): CatalogueFieldError | undefined {
  if (!name) return "nameRequired";
  if (name.length > NAME_MAX_LENGTH) return "nameTooLong";
}

function validateSlug(slug: string): CatalogueFieldError | undefined {
  if (!slug) return "slugRequired";
  if (slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) return "slugInvalid";
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
}

export type CategoryFieldErrors = Partial<
  Record<keyof CategoryInput | "image", CatalogueFieldError>
>;

export function readCategory(data: FormData): CategoryInput {
  return {
    name: text(data, "name"),
    slug: text(data, "slug"),
    description: text(data, "description"),
    sortOrder: text(data, "sortOrder"),
    isActive: data.get("isActive") === "on",
  };
}

export function parseSortOrder(value: string): number | null {
  if (value === "") return 0;
  if (!/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Math.abs(parsed) <= INT_MAX ? parsed : null;
}

export function validateCategory(input: CategoryInput): CategoryFieldErrors {
  const errors: CategoryFieldErrors = {};
  errors.name = validateName(input.name);
  errors.slug = validateSlug(input.slug);
  if (input.description.length > CATEGORY_DESCRIPTION_MAX_LENGTH) {
    errors.description = "descriptionTooLong";
  }
  if (parseSortOrder(input.sortOrder) === null) errors.sortOrder = "sortOrderInvalid";
  return compact(errors);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductInput {
  name: string;
  slug: string;
  sku: string;
  categoryId: string;
  shortDescription: string;
  description: string;
  price: string;
  compareAtPrice: string;
  currencyCode: string;
  isActive: boolean;
  /** Units on hand (whole number). Saved through adjust_inventory(). */
  stock: string;
  lowStockThreshold: string;
}

export type ProductFieldErrors = Partial<Record<keyof ProductInput, CatalogueFieldError>>;

export function readProduct(data: FormData): ProductInput {
  return {
    name: text(data, "name"),
    slug: text(data, "slug"),
    sku: text(data, "sku"),
    categoryId: text(data, "categoryId"),
    shortDescription: text(data, "shortDescription"),
    description: text(data, "description"),
    price: text(data, "price"),
    compareAtPrice: text(data, "compareAtPrice"),
    currencyCode: text(data, "currencyCode"),
    isActive: data.get("isActive") === "on",
    stock: text(data, "stock"),
    lowStockThreshold: text(data, "lowStockThreshold"),
  };
}

/**
 * `reserved` is the product's reserved quantity when known (edit form); stock
 * can't go below it. The database re-checks it inside adjust_inventory().
 */
export function validateProduct(input: ProductInput, reserved = 0): ProductFieldErrors {
  const errors: ProductFieldErrors = {};
  errors.name = validateName(input.name);
  errors.slug = validateSlug(input.slug);

  if (!input.sku) errors.sku = "skuRequired";
  else if (!SKU_PATTERN.test(input.sku)) errors.sku = "skuInvalid";

  if (!input.categoryId) errors.categoryId = "categoryRequired";
  else if (!isUuid(input.categoryId)) errors.categoryId = "categoryInvalid";

  if (input.shortDescription.length > SHORT_DESCRIPTION_MAX_LENGTH) {
    errors.shortDescription = "shortDescriptionTooLong";
  }
  if (input.description.length > PRODUCT_DESCRIPTION_MAX_LENGTH) {
    errors.description = "descriptionTooLong";
  }

  const stock = parseWholeNumber(input.stock);
  if (!input.stock) errors.stock = "stockRequired";
  else if (stock === null) errors.stock = "stockInvalid";
  else if (stock < reserved) errors.stock = "stockBelowReserved";
  if (!input.lowStockThreshold) errors.lowStockThreshold = "thresholdRequired";
  else if (parseWholeNumber(input.lowStockThreshold) === null) {
    errors.lowStockThreshold = "thresholdInvalid";
  }

  if (!isCurrencyCode(input.currencyCode)) {
    errors.currencyCode = "currencyInvalid";
    return compact(errors);
  }

  const price = parseMoney(input.price, input.currencyCode);
  if (!price.ok) errors.price = price.error;

  if (input.compareAtPrice) {
    const compareAt = parseMoney(input.compareAtPrice, input.currencyCode);
    if (!compareAt.ok) errors.compareAtPrice = compareAt.error;
    // Matches CHECK products_compare_at_price_gt_price: a "was" price must be
    // higher than the selling price, or there is no discount to show.
    else if (price.ok && compareAt.minor <= price.minor) {
      errors.compareAtPrice = "compareAtNotHigher";
    }
  }

  return compact(errors);
}

function compact<T extends Record<string, unknown>>(errors: T): T {
  for (const key of Object.keys(errors)) if (errors[key] === undefined) delete errors[key];
  return errors;
}

export function hasFieldErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}
