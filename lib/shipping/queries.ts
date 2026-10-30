import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_DELIVERY_DAYS,
  isShippingMethodCode,
  isShippingRateType,
  SHIPPING_METHOD_CODES,
  type ShippingCountryConfig,
  type ShippingMethodConfig,
} from "./rules";

/**
 * Shipping configuration reads (migration 037), through the signed-in
 * admin's client: RLS returns inactive countries and methods to admins only.
 * Amounts are minor units of each country's currency.
 */

/** Missing table: migration 037 hasn't been applied yet. */
function isMissingSchema(error: { code?: string }) {
  return ["42P01", "PGRST205"].includes(error.code ?? "");
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[shipping] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

const SELECT = `country_code, currency_code, is_active, updated_at,
  methods:shipping_methods(code, rate_type, is_active, free_shipping_threshold,
    min_delivery_days, max_delivery_days, rates:shipping_rates(min_value, max_value, amount))`;

interface CountryRow {
  country_code: string;
  currency_code: string;
  is_active: boolean;
  updated_at: string;
  methods: {
    code: string;
    rate_type: string;
    is_active: boolean;
    free_shipping_threshold: number | null;
    min_delivery_days: number;
    max_delivery_days: number;
    rates: { min_value: number; max_value: number | null; amount: number }[];
  }[];
}

/** Both methods, in display order; a missing one gets inactive defaults. */
function toConfig(row: CountryRow): ShippingCountryConfig {
  const methods = SHIPPING_METHOD_CODES.map((code): ShippingMethodConfig => {
    const stored = row.methods.find((method) => method.code === code);
    const [minDays, maxDays] = DEFAULT_DELIVERY_DAYS[code];
    if (!stored || !isShippingMethodCode(stored.code)) {
      return {
        code,
        rateType: "FLAT",
        isActive: false,
        amount: 0,
        bands: [],
        freeShippingThreshold: null,
        minDeliveryDays: minDays,
        maxDeliveryDays: maxDays,
      };
    }
    const rateType = isShippingRateType(stored.rate_type) ? stored.rate_type : "FLAT";
    const rates = [...stored.rates].sort((a, b) => a.min_value - b.min_value);
    return {
      code,
      rateType,
      isActive: stored.is_active,
      // FLAT: the single tier starting at 0; tiered: every band, in order.
      amount: rateType === "FLAT" ? (rates[0]?.amount ?? 0) : 0,
      bands:
        rateType === "FLAT"
          ? []
          : rates.map((rate) => ({
              minValue: rate.min_value,
              maxValue: rate.max_value,
              amount: rate.amount,
            })),
      freeShippingThreshold: stored.free_shipping_threshold,
      minDeliveryDays: stored.min_delivery_days,
      maxDeliveryDays: stored.max_delivery_days,
    };
  });
  return {
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    isActive: row.is_active,
    updatedAt: row.updated_at,
    methods,
  };
}

/**
 * Every configured delivery country, by code. null until migration 037 is
 * applied (the page then explains what's missing). Memoised per request.
 */
export const listShippingConfigs = cache(async (): Promise<ShippingCountryConfig[] | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_countries")
    .select(SELECT)
    .order("country_code", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) {
      console.warn("[shipping] tables missing: apply migration 037");
      return null;
    }
    fail("shipping countries", error);
  }
  return (data as unknown as CountryRow[]).map(toConfig);
});

/** One country's configuration, or null when it isn't configured. Memoised per request. */
export const getShippingConfig = cache(
  async (countryCode: string): Promise<ShippingCountryConfig | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shipping_countries")
      .select(SELECT)
      .eq("country_code", countryCode)
      .maybeSingle();
    if (error) {
      if (isMissingSchema(error)) return null;
      fail("shipping country", error);
    }
    return data ? toConfig(data as unknown as CountryRow) : null;
  },
);

/** Whether any order used this country's configuration (it can then only be disabled). */
export async function countryHasOrders(countryCode: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("shipping_snapshot->>country_code", countryCode);
  if (error) fail("shipping orders", error);
  return (count ?? 0) > 0;
}

/**
 * Whether products and variants have weights yet (migration 038). The
 * product and variant forms show their weight field only then.
 */
export const hasProductWeights = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { error } = await supabase.from("products").select("weight_grams").limit(1);
  if (!error) return true;
  if (error.code === "42703" || isMissingSchema(error)) return false;
  fail("product weights", error);
});

/**
 * Active products without their own weight. Weight-based rates count their
 * items as 0 g unless the chosen variant has a weight.
 */
export async function countUnweighedProducts(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .is("weight_grams", null);
  if (error) {
    if (error.code === "42703") return 0;
    fail("unweighed products", error);
  }
  return count ?? 0;
}
