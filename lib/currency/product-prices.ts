// The product form's "Prices by currency" rows, shared by the form (instant
// feedback) and saveProduct (the authority). Self-contained for `node --test`.

import {
  minorToDecimal,
  parseMinor,
  parsePriceRow,
  type Currency,
  type PriceError,
} from "./money.ts";

/**
 * One row as the form posts it (decimal strings, as typed). `salePrice` is
 * the selling price (what the customer pays, required); `price` is the
 * optional regular price, shown struck through when it is higher.
 */
export interface PriceInput {
  currency: string;
  price: string;
  salePrice: string;
}

export type PriceRowErrors = Record<string, { price?: PriceError; salePrice?: PriceError }>;

/** Form field holding the non-base rows as JSON. */
export const CURRENCY_PRICES_FIELD = "currencyPrices";

/**
 * A form row (selling price required, regular price optional) in minor
 * units, stored as product_prices expects: with a regular price, price =
 * regular and salePrice = selling; without one, price = selling and no sale.
 * `required: false` (inactive currency) lets an empty row mean "not sold".
 */
export function parseSellingRow(
  price: string,
  sellingPrice: string,
  decimals: number,
  required = true,
):
  | { ok: true; minor: { price: bigint; salePrice: bigint | null } | null }
  | { ok: false; errors: { price?: PriceError; salePrice?: PriceError } } {
  if (!required && !price.trim() && !sellingPrice.trim()) return { ok: true, minor: null };
  if (!price.trim()) {
    const selling = parseMinor(sellingPrice, decimals);
    return selling.ok
      ? { ok: true, minor: { price: selling.minor, salePrice: null } }
      : { ok: false, errors: { salePrice: selling.error } };
  }
  // Same rules as a CSV row (price, sale price); a missing selling price is
  // reported on its own column.
  if (!sellingPrice.trim()) {
    const regular = parseMinor(price, decimals);
    return {
      ok: false,
      errors: { salePrice: "priceRequired", ...(regular.ok ? {} : { price: regular.error }) },
    };
  }
  return parsePriceRow(price, sellingPrice, decimals);
}

/** The row to show for saved minor units (no sale: the price is the selling price). */
export function sellingRowInput(
  saved: { price: number | string; salePrice: number | string | null } | undefined,
  decimals: number,
): Pick<PriceInput, "price" | "salePrice"> {
  if (!saved) return { price: "", salePrice: "" };
  return saved.salePrice != null
    ? {
        price: minorToDecimal(saved.price, decimals),
        salePrice: minorToDecimal(saved.salePrice, decimals),
      }
    : { price: "", salePrice: minorToDecimal(saved.price, decimals) };
}

/**
 * Parses the posted rows against the store's currencies (by code). Rows for
 * unknown currencies are ignored. Every active currency except `base` (the
 * product's own price fields) needs a selling price; an empty row for an
 * inactive one means "not sold in this currency" and is left out of `rows`.
 */
export function readCurrencyPrices(
  raw: string,
  currencies: readonly (Pick<Currency, "code" | "decimals"> & { isActive?: boolean })[],
  base?: string,
): {
  rows: { currency: string; price: bigint; salePrice: bigint | null }[];
  errors: PriceRowErrors;
} {
  let input: unknown;
  try {
    input = JSON.parse(raw || "[]");
  } catch {
    input = [];
  }
  const byCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const seen = new Set<string>();
  const rows: { currency: string; price: bigint; salePrice: bigint | null }[] = [];
  const errors: PriceRowErrors = {};
  for (const entry of Array.isArray(input) ? input.slice(0, 50) : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { currency: code, price = "", salePrice = "" } = entry as Record<string, unknown>;
    const currency = typeof code === "string" ? byCode.get(code) : undefined;
    if (!currency || seen.has(currency.code)) continue;
    seen.add(currency.code);
    const parsed = parseSellingRow(
      String(price),
      String(salePrice),
      currency.decimals,
      currency.isActive !== false,
    );
    if (!parsed.ok) errors[currency.code] = parsed.errors;
    else if (parsed.minor) rows.push({ currency: currency.code, ...parsed.minor });
  }
  if (base !== undefined) {
    for (const currency of currencies) {
      if (currency.isActive === false || currency.code === base || seen.has(currency.code)) {
        continue;
      }
      errors[currency.code] = { salePrice: "priceRequired" };
    }
  }
  return { rows, errors };
}
