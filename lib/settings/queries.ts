import "server-only";
import { cache } from "react";
import type { Locale } from "@/config/i18n";
import { activeRegion } from "@/config/region";
import { createClient } from "@/lib/supabase/server";

/**
 * The single store configuration (store_settings, migration 020), read with
 * the signed-in admin's client: RLS returns the row to active admins only.
 * Money columns are selected as text so NUMERIC values never pass through
 * floats.
 */

export interface StoreSettings {
  store_name: string;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country_code: string;
  currency_code: string;
  timezone: string;
  default_locale: Locale;
  tax_enabled: boolean;
  tax_rate: string;
  prices_include_tax: boolean;
  tax_registration_number: string | null;
  shipping_fee: string;
  free_shipping_threshold: string | null;
  delivery_min_days: number;
  delivery_max_days: number;
  min_order_amount: string | null;
  max_quantity_per_item: number;
  allow_customer_cancellation: boolean;
  notify_new_order: boolean;
  notify_low_stock: boolean;
  notify_order_cancelled: boolean;
  notification_email: string | null;
  updated_at: string;
}

/** The market values the rest of the admin app formats and filters with. */
export interface StoreRegion {
  countryCode: string;
  currencyCode: string;
  timezone: string;
}

const COLUMNS = `store_name, logo_url, contact_email, contact_phone,
  address_line1, address_line2, city, state_region, postal_code,
  country_code, currency_code, timezone, default_locale,
  tax_enabled, tax_rate::text, prices_include_tax, tax_registration_number,
  shipping_fee::text, free_shipping_threshold::text, delivery_min_days, delivery_max_days,
  min_order_amount::text, max_quantity_per_item, allow_customer_cancellation,
  notify_new_order, notify_low_stock, notify_order_cancelled, notification_email, updated_at`;

/** The settings row, or null if it doesn't exist / isn't visible. Throws on failure. */
export const getStoreSettings = cache(async (): Promise<StoreSettings | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("store_settings").select(COLUMNS).maybeSingle();
  // Table not created yet (migration 020 not applied): same as no row.
  if (error?.code === "PGRST205") return null;
  if (error) {
    console.error(
      `[settings] load failed: code=${error.code || "-"} message=${error.message || "-"}`,
    );
    throw new Error("Unable to load store settings");
  }
  return data as unknown as StoreSettings | null;
});

/**
 * Configured country / currency / timezone for formatting and date filters.
 * Never fails a page: if the settings can't be read it falls back to the
 * code defaults (config/region.ts) and logs why.
 */
export const getStoreRegion = cache(async (): Promise<StoreRegion> => {
  const fallback = {
    countryCode: activeRegion.countryCode,
    currencyCode: activeRegion.currencyCode,
    timezone: activeRegion.timezone,
  };
  try {
    const settings = await getStoreSettings();
    if (!settings) return fallback;
    return {
      countryCode: settings.country_code,
      currencyCode: settings.currency_code,
      timezone: settings.timezone,
    };
  } catch {
    return fallback;
  }
});
