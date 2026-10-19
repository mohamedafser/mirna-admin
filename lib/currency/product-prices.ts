// The product form's "Prices by currency" rows, shared by the form (instant
// feedback) and saveProduct (the authority). Self-contained for `node --test`.

import { parsePriceRow, type Currency, type PriceError } from "./money.ts";

/** One row as the form posts it (decimal strings, as typed). */
export interface PriceInput {
  currency: string;
  price: string;
  salePrice: string;
}

export type PriceRowErrors = Record<string, { price?: PriceError; salePrice?: PriceError }>;

/** Form field holding the non-base rows as JSON. */
export const CURRENCY_PRICES_FIELD = "currencyPrices";

/**
 * Parses the posted rows against the store's currencies (by code). Rows for
 * unknown currencies are ignored; empty rows mean "not sold in this
 * currency" and are left out of `rows`.
 */
export function readCurrencyPrices(
  raw: string,
  currencies: readonly Pick<Currency, "code" | "decimals">[],
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
  const rows: { currency: string; price: bigint; salePrice: bigint | null }[] = [];
  const errors: PriceRowErrors = {};
  for (const entry of Array.isArray(input) ? input.slice(0, 50) : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { currency: code, price = "", salePrice = "" } = entry as Record<string, unknown>;
    const currency = typeof code === "string" ? byCode.get(code) : undefined;
    if (!currency || rows.some((row) => row.currency === currency.code)) continue;
    const parsed = parsePriceRow(String(price), String(salePrice), currency.decimals);
    if (!parsed.ok) errors[currency.code] = parsed.errors;
    else if (parsed.minor) rows.push({ currency: currency.code, ...parsed.minor });
  }
  return { rows, errors };
}
