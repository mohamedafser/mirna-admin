"use server";

import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { listCurrencies } from "@/lib/currencies/queries";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getShippingConfig } from "./queries";
import { readShippingForm, validateShippingForm, type ShippingFieldError } from "./rules";

/**
 * Shipping configuration mutations. Every action re-checks that the caller is
 * an active admin; RLS and migration 037's checks (an active country needs an
 * active method with a rate, delivery days in order, only supported rate
 * types, a configuration used by orders can't be deleted) are the final word.
 */

export type ShippingError =
  | "forbidden"
  | "notFound"
  | "exists"
  | "countryNotSold"
  | "noActiveMethod"
  | "stale"
  | "inUse"
  | "invalid"
  | "failed";

export type ShippingResult = { ok: true } | { ok: false; error: ShippingError };

export type ShippingSaveResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error?: ShippingError; fieldErrors: Partial<Record<string, ShippingFieldError>> };

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

function log(scope: string, error: { code?: string; message?: string }) {
  console.error(`[shipping] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
}

/** Database errors → what the admin is told. */
function toError(error: { code?: string; message?: string }, scope: string): ShippingError {
  switch (error.message) {
    case "shipping:no_active_method":
      return "noActiveMethod";
    case "shipping:stale":
      return "stale";
    case "shipping:not_found":
      return "notFound";
    case "shipping:country_not_sold":
      return "countryNotSold";
    case "shipping:invalid":
    case "shipping:invalid_bands":
      return "invalid";
  }
  if (error.code === "42501") return "forbidden";
  if (error.code === "23505") return "exists";
  // orders_shipping_method_id_fkey: orders used this configuration.
  if (error.code === "23503") return "inUse";
  if (error.code === "23514" || error.code === "22P02") return "invalid";
  log(scope, error);
  return "failed";
}

/**
 * Starts delivering to a country the store sells in (country_currency), in
 * that country's currency, with draft Standard and Express methods. It stays
 * disabled until it's configured.
 */
export async function addShippingCountry(countryCode: string): Promise<ShippingResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!COUNTRY_PATTERN.test(countryCode)) return { ok: false, error: "countryNotSold" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_shipping_country", { p_country_code: countryCode });
  if (error) return { ok: false, error: toError(error, "add country") };
  refresh();
  return { ok: true };
}

/** Enables or disables delivery to a country (enabling needs an active method). */
export async function setShippingCountryActive(
  countryCode: string,
  active: boolean,
): Promise<ShippingResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!COUNTRY_PATTERN.test(countryCode)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_countries")
    .update({ is_active: active })
    .eq("country_code", countryCode)
    .select("country_code")
    .maybeSingle();
  if (error) return { ok: false, error: toError(error, "set active") };
  if (!data) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

/**
 * Saves a country's status and both methods in one transaction. `updatedAt`
 * is the version the form was opened with: a save made meanwhile (another tab
 * or admin) is reported as "stale" instead of being overwritten.
 */
export async function saveShippingCountry(data: FormData): Promise<ShippingSaveResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden", fieldErrors: {} };
  const countryCode = String(data.get("countryCode") ?? "");
  const updatedAt = String(data.get("updatedAt") ?? "");
  if (!COUNTRY_PATTERN.test(countryCode)) {
    return { ok: false, error: "notFound", fieldErrors: {} };
  }

  // The currency's decimals decide how amounts are read (1.500 KWD = 1500).
  const [config, currencies] = await Promise.all([
    getShippingConfig(countryCode),
    listCurrencies(),
  ]);
  if (!config) return { ok: false, error: "notFound", fieldErrors: {} };
  const currency = currencies?.find((row) => row.code === config.currencyCode);
  if (!currency) return { ok: false, error: "failed", fieldErrors: {} };

  const result = validateShippingForm(readShippingForm(data), currency.decimals);
  if (!result.ok) {
    return { ok: false, error: result.formError, fieldErrors: result.fieldErrors };
  }

  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("save_shipping_country", {
    p_country_code: countryCode,
    p_updated_at: updatedAt || null,
    p_is_active: result.isActive,
    p_methods: result.methods as unknown as Json,
  });
  if (error) return { ok: false, error: toError(error, "save"), fieldErrors: {} };
  refresh();
  return { ok: true, updatedAt: version ?? "" };
}

/**
 * Stops delivering to a country and removes its configuration. Refused once
 * an order used it (disable it instead: orders keep their own snapshot).
 */
export async function deleteShippingCountry(countryCode: string): Promise<ShippingResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!COUNTRY_PATTERN.test(countryCode)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_countries")
    .delete()
    .eq("country_code", countryCode)
    .select("country_code")
    .maybeSingle();
  if (error) return { ok: false, error: toError(error, "delete") };
  if (!data) return { ok: false, error: "notFound" };
  return { ok: true };
}
