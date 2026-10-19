// Bulk price CSV (Currencies page): one row per product or variant and
// currency. Amounts are written in the currency's decimals ("1.500" BHD); an
// empty price removes that price. Self-contained, so `node --test` runs its
// tests directly.

import { minorToDecimal, parsePriceRow, type Currency, type PriceError } from "./money.ts";

export const PRICE_CSV_HEADER = ["product_sku", "variant_sku", "currency", "price", "sale_price"];
export const PRICE_CSV_MAX_ROWS = 20000;

export interface PriceCsvRow {
  /** 1-based line in the file. */
  line: number;
  productSku: string;
  /** "" for the product-level price. */
  variantSku: string;
  currency: string;
  /** null = remove this price. */
  minor: { price: bigint; salePrice: bigint | null } | null;
}

export type PriceCsvError =
  | "header"
  | "tooManyRows"
  | "columns"
  | "skuRequired"
  | "skuUnknown"
  | "currencyUnknown"
  | "duplicate"
  | PriceError;

export interface PriceCsvIssue {
  /** 1-based line in the file. */
  line: number;
  error: PriceCsvError;
}

/** RFC 4180 fields: quotes, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Quotes a field when it contains a comma, quote or newline (and neutralises formulas). */
function csvField(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/**
 * Validates a price CSV against the store's currencies. Returns every issue
 * (by line) so the admin can fix the file in one go; rows are only usable
 * when `issues` is empty. Blank lines are skipped.
 */
export function readPriceCsv(
  text: string,
  currencies: readonly Pick<Currency, "code" | "decimals">[],
): { rows: PriceCsvRow[]; issues: PriceCsvIssue[] } {
  const lines = parseCsv(text);
  const header = (lines[0] ?? []).map((cell) => cell.trim().toLowerCase());
  if (PRICE_CSV_HEADER.some((name, index) => header[index] !== name)) {
    return { rows: [], issues: [{ line: 1, error: "header" }] };
  }
  if (lines.length - 1 > PRICE_CSV_MAX_ROWS) {
    return { rows: [], issues: [{ line: 1, error: "tooManyRows" }] };
  }

  const byCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const rows: PriceCsvRow[] = [];
  const issues: PriceCsvIssue[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((cell) => cell.trim() === "")) return;
    if (cells.length < 4 || cells.length > PRICE_CSV_HEADER.length) {
      issues.push({ line, error: "columns" });
      return;
    }
    const [productSku, variantSku, rawCurrency, price, salePrice = ""] = cells.map((cell) =>
      cell.trim(),
    );
    const currency = byCode.get(rawCurrency.toUpperCase());
    if (!productSku) return void issues.push({ line, error: "skuRequired" });
    if (!currency) return void issues.push({ line, error: "currencyUnknown" });
    const key = `${productSku.toUpperCase()}|${variantSku.toUpperCase()}|${currency.code}`;
    if (seen.has(key)) return void issues.push({ line, error: "duplicate" });
    seen.add(key);
    const parsed = parsePriceRow(price, salePrice, currency.decimals);
    if (!parsed.ok) {
      issues.push({ line, error: (parsed.errors.price ?? parsed.errors.salePrice)! });
      return;
    }
    rows.push({ line, productSku, variantSku, currency: currency.code, minor: parsed.minor });
  });
  return { rows, issues };
}

/** One CSV line for a price (empty amounts when there is none yet). */
export function priceCsvLine(
  productSku: string,
  variantSku: string,
  currency: Pick<Currency, "code" | "decimals">,
  minor: { price: bigint | number; salePrice: bigint | number | null } | null,
): string[] {
  return [
    productSku,
    variantSku,
    currency.code,
    minor ? minorToDecimal(minor.price, currency.decimals) : "",
    minor?.salePrice != null ? minorToDecimal(minor.salePrice, currency.decimals) : "",
  ];
}
