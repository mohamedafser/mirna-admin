import "server-only";
import { cache } from "react";
import type { Currency } from "@/lib/currency/money";
import { createClient } from "@/lib/supabase/server";

/** Missing table: migration 031 hasn't been applied yet. */
function isMissingSchema(error: { code?: string }) {
  return ["42P01", "PGRST205"].includes(error.code ?? "");
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[currencies] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

/**
 * Every currency (active or not), default first, then by code. null until
 * migration 031 is applied: the product form then keeps its single price
 * and the Currencies page explains what's missing. Memoised per request.
 */
export const listCurrencies = cache(async (): Promise<Currency[] | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .select("code, symbol, decimals, is_active, is_default")
    .order("is_default", { ascending: false })
    .order("code", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) {
      console.warn("[currencies] tables missing: apply migration 031");
      return null;
    }
    fail("currencies", error);
  }
  return data.map((row) => ({
    code: row.code,
    symbol: row.symbol,
    decimals: row.decimals,
    isActive: row.is_active,
    isDefault: row.is_default,
  }));
});

/** Countries the store ships to, with their currency, by country code. */
export async function listShippingCountries(): Promise<
  { countryCode: string; currencyCode: string }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("country_currency")
    .select("country_code, currency_code")
    .order("country_code", { ascending: true });
  if (error) fail("shipping countries", error);
  return data.map((row) => ({ countryCode: row.country_code, currencyCode: row.currency_code }));
}

/** A product's product-level prices (minor units), by currency code. */
export async function getProductPrices(
  productId: string,
): Promise<Record<string, { price: number; salePrice: number | null }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_prices")
    .select("currency_code, price, sale_price")
    .eq("product_id", productId)
    .is("variant_id", null);
  if (error) fail("product prices", error);
  return Object.fromEntries(
    data.map((row) => [row.currency_code, { price: row.price, salePrice: row.sale_price }]),
  );
}
