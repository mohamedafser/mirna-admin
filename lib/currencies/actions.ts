"use server";

import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { readPriceCsv, type PriceCsvIssue } from "@/lib/currency/csv";
import {
  readCurrencyInput,
  SYMBOL_MAX_LENGTH,
  validateCurrencyInput,
  type CurrencyFieldErrors,
} from "@/lib/currency/rules";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { listCurrencies } from "./queries";

/**
 * Currency mutations. Every action re-checks that the caller is an active
 * admin; RLS and migration 031's checks (one default, the default is active,
 * a product's own-currency price can't be removed) are the final word.
 */

export type CurrencyError = "forbidden" | "notFound" | "defaultRequired" | "failed";
export type CurrencyResult = { ok: true } | { ok: false; error: CurrencyError };

const CODE_PATTERN = /^[A-Z]{3}$/;

function log(scope: string, error: { code?: string; message?: string }) {
  console.error(`[currencies] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
}

export type CurrencyFormResult =
  | { ok: true; code: string }
  | { ok: false; error?: CurrencyError; fieldErrors: CurrencyFieldErrors };

/**
 * Adds a currency (code, symbol, decimals, enabled or not). Its code and
 * decimals are fixed from then on: prices are stored in its minor units.
 */
export async function createCurrency(data: FormData): Promise<CurrencyFormResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden", fieldErrors: {} };
  const input = readCurrencyInput(data);
  const existing = ((await listCurrencies()) ?? []).map((currency) => currency.code);
  const fieldErrors = validateCurrencyInput(input, existing);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.from("currencies").insert({
    code: input.code,
    symbol: input.symbol,
    decimals: Number(input.decimals),
    is_active: input.isActive,
  });
  if (error) {
    // 23505: added meanwhile (another tab or admin).
    if (error.code === "23505") return { ok: false, fieldErrors: { code: "codeTaken" } };
    log("create", error);
    return {
      ok: false,
      error: error.code === "42501" ? "forbidden" : "failed",
      fieldErrors: {},
    };
  }
  refresh();
  return { ok: true, code: input.code };
}

/** Changes a currency's display symbol (shown in the store's currency switcher). */
export async function updateCurrencySymbol(
  code: string,
  rawSymbol: string,
): Promise<CurrencyFormResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden", fieldErrors: {} };
  if (!CODE_PATTERN.test(code)) return { ok: false, error: "notFound", fieldErrors: {} };
  const symbol = rawSymbol.trim();
  if (!symbol) return { ok: false, fieldErrors: { symbol: "symbolRequired" } };
  if (symbol.length > SYMBOL_MAX_LENGTH) {
    return { ok: false, fieldErrors: { symbol: "symbolTooLong" } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .update({ symbol })
    .eq("code", code)
    .select("code")
    .maybeSingle();
  if (error) {
    log("update symbol", error);
    return {
      ok: false,
      error: error.code === "42501" ? "forbidden" : "failed",
      fieldErrors: {},
    };
  }
  if (!data) return { ok: false, error: "notFound", fieldErrors: {} };
  refresh();
  return { ok: true, code };
}

/** Enables or disables a currency (the default currency can't be disabled). */
export async function setCurrencyActive(code: string, active: boolean): Promise<CurrencyResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!CODE_PATTERN.test(code)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .update({ is_active: active })
    .eq("code", code)
    .select("code")
    .maybeSingle();
  if (error) {
    // 23514: currencies_default_active.
    if (error.code === "23514") return { ok: false, error: "defaultRequired" };
    log("set active", error);
    return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  }
  if (!data) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

/** Makes an active currency the store default. */
export async function setDefaultCurrency(code: string): Promise<CurrencyResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!CODE_PATTERN.test(code)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_default_currency", { p_code: code });
  if (error) {
    if (error.message === "currency:not_active") return { ok: false, error: "notFound" };
    log("set default", error);
    return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  }
  refresh();
  return { ok: true };
}

export type PriceImportError =
  "forbidden" | "empty" | "fileTooLarge" | "invalid" | "baseRequired" | "failed";

export type PriceImportResult =
  | { ok: true; updated: number; removed: number }
  | { ok: false; error: PriceImportError; issues?: PriceCsvIssue[] };

/** 2 MB: about 20,000 rows. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Imports a price CSV (see lib/currency/csv.ts), all or nothing: every row is
 * checked first (currency, amounts, SKUs) and nothing is saved while any row
 * has a problem; the database then applies the rows in one transaction.
 */
export async function importPrices(data: FormData): Promise<PriceImportResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "empty" };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "fileTooLarge" };

  const currencies = (await listCurrencies()) ?? [];
  const { rows, issues } = readPriceCsv(await file.text(), currencies);
  if (issues.length > 0) return { ok: false, error: "invalid", issues: issues.slice(0, 50) };
  if (rows.length === 0) return { ok: false, error: "empty" };

  // SKUs → ids (SKUs are unique case-insensitively across products and variants).
  const supabase = await createClient();
  const productSkus = [...new Set(rows.map((row) => row.productSku))];
  const variantSkus = [...new Set(rows.flatMap((row) => (row.variantSku ? [row.variantSku] : [])))];
  const products = new Map<string, string>();
  const variants = new Map<string, { id: string; productId: string }>();
  for (let i = 0; i < productSkus.length; i += 500) {
    const { data: found, error } = await supabase
      .from("products")
      .select("id, sku")
      .in("sku", productSkus.slice(i, i + 500));
    if (error) {
      log("read products", error);
      return { ok: false, error: "failed" };
    }
    for (const row of found) products.set(row.sku.toUpperCase(), row.id);
  }
  for (let i = 0; i < variantSkus.length; i += 500) {
    const { data: found, error } = await supabase
      .from("product_variants")
      .select("id, sku, product_id")
      .in("sku", variantSkus.slice(i, i + 500));
    if (error) {
      log("read variants", error);
      return { ok: false, error: "failed" };
    }
    for (const row of found)
      variants.set(row.sku.toUpperCase(), { id: row.id, productId: row.product_id });
  }

  const missing: PriceCsvIssue[] = [];
  const payload = rows.flatMap((row) => {
    const productId = products.get(row.productSku.toUpperCase());
    const variant = row.variantSku ? variants.get(row.variantSku.toUpperCase()) : null;
    if (!productId || (row.variantSku && variant?.productId !== productId)) {
      missing.push({ line: row.line, error: "skuUnknown" });
      return [];
    }
    return [
      {
        product_id: productId,
        variant_id: variant?.id ?? null,
        currency_code: row.currency,
        // Minor units as strings: exact beyond 2^53.
        price: row.minor ? row.minor.price.toString() : null,
        sale_price: row.minor?.salePrice != null ? row.minor.salePrice.toString() : null,
      },
    ];
  });
  if (missing.length > 0) return { ok: false, error: "invalid", issues: missing.slice(0, 50) };

  const { data: updated, error } = await supabase.rpc("import_product_prices", {
    p_rows: payload as unknown as Json,
  });
  if (error) {
    if (error.message === "product_price:base_required")
      return { ok: false, error: "baseRequired" };
    log("import", error);
    return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  }
  refresh();
  return { ok: true, updated: updated ?? 0, removed: payload.filter((row) => !row.price).length };
}
