"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import {
  extensionFor,
  sniffImageType,
  STORE_ASSETS_BUCKET,
  validateImageFile,
  type ImageFileError,
} from "@/lib/catalogue/images";
import { parseWholeNumber } from "@/lib/inventory/rules";
import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import {
  normalizePhone,
  parseTaxRate,
  readSettings,
  validateSettings,
  type SettingsFieldErrors,
} from "./rules";

export type SettingsFormError = "forbidden" | "notFound" | "conflict" | "network" | "unexpected";
export type SettingsWarning = "logoUploadFailed" | "logoCleanupFailed";

export interface SettingsFormResult {
  status: "idle" | "success" | "error";
  error?: SettingsFormError;
  fieldErrors: SettingsFieldErrors & { logo?: ImageFileError };
  warning?: SettingsWarning;
  /** Changes on every submit, so the client can react to each result. */
  at: number;
}

function result(
  status: SettingsFormResult["status"],
  extra: Partial<SettingsFormResult> = {},
): SettingsFormResult {
  return { status, fieldErrors: {}, ...extra, at: Date.now() };
}

function log(scope: string, error: { code?: string; message?: string }) {
  console.error(`[settings] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
}

/** Money as an exact decimal string (validated beforehand); "" → null. */
function money(raw: string, currency: string, fallback: string | null): string | null {
  if (!raw) return fallback;
  const parsed = parseMoney(raw, currency);
  return parsed.ok ? parsed.value : fallback;
}

/**
 * Saves the store configuration. Re-checks the admin session, validates with
 * the form's rules, then updates the single row with the admin's own session
 * (RLS + column grants + CHECK constraints + timezone trigger decide too).
 * Optimistic concurrency: only the version the admin loaded is updated.
 * The logo is uploaded first, then linked, then the old file deleted, so the
 * row never points at a missing file.
 */
export async function saveSettings(
  _prev: SettingsFormResult,
  data: FormData,
): Promise<SettingsFormResult> {
  if (!(await getAdminOrNull())) return result("error", { error: "forbidden" });

  const version = String(data.get("updatedAt") ?? "");
  const input = readSettings(data);
  const fieldErrors: SettingsFormResult["fieldErrors"] = validateSettings(input);

  const file = data.get("logo");
  const upload = file instanceof File && file.size > 0 ? file : null;
  const removeLogo = data.get("removeLogo") === "on";
  let logoType: { contentType: string; ext: string } | null = null;
  if (upload) {
    const declared = validateImageFile(upload);
    const detected = declared
      ? null
      : sniffImageType(new Uint8Array(await upload.slice(0, 16).arrayBuffer()));
    if (declared) fieldErrors.logo = declared;
    else if (!detected) fieldErrors.logo = "imageType";
    else logoType = { contentType: detected, ext: extensionFor[detected] };
  }
  if (Object.keys(fieldErrors).length > 0) return result("error", { fieldErrors });

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("store_settings")
    .select("updated_at, logo_path")
    .maybeSingle();
  if (readError) {
    log("read settings", readError);
    return result("error", { error: readError.code ? "unexpected" : "network" });
  }
  if (!current) return result("error", { error: "notFound" });
  if (current.updated_at !== version) return result("error", { error: "conflict" });

  const currency = input.currencyCode;
  // NUMERIC values are sent as exact decimal strings (never floats).
  const asNumeric = (value: string | null) => value as unknown as number;
  const values = {
    store_name: input.storeName,
    contact_email: input.contactEmail || null,
    contact_phone: input.contactPhone ? normalizePhone(input.contactPhone) : null,
    address_line1: input.addressLine1 || null,
    address_line2: input.addressLine2 || null,
    city: input.city || null,
    state_region: input.stateRegion || null,
    postal_code: input.postalCode || null,
    country_code: input.countryCode,
    currency_code: currency,
    timezone: input.timezone,
    default_locale: input.defaultLocale,
    tax_enabled: input.taxEnabled,
    tax_rate: asNumeric(input.taxRate ? parseTaxRate(input.taxRate) : "0"),
    prices_include_tax: input.pricesIncludeTax,
    tax_registration_number: input.taxRegistrationNumber || null,
    shipping_fee: asNumeric(money(input.shippingFee, currency, "0")),
    free_shipping_threshold: asNumeric(money(input.freeShippingThreshold, currency, null)),
    delivery_min_days: parseWholeNumber(input.deliveryMinDays) ?? 0,
    delivery_max_days: parseWholeNumber(input.deliveryMaxDays) ?? 0,
    min_order_amount: asNumeric(money(input.minOrderAmount, currency, null)),
    max_quantity_per_item: parseWholeNumber(input.maxQuantityPerItem) ?? 1,
    allow_customer_cancellation: input.allowCustomerCancellation,
    notify_new_order: input.notifyNewOrder,
    notify_low_stock: input.notifyLowStock,
    notify_order_cancelled: input.notifyOrderCancelled,
    notification_email: input.notificationEmail || null,
  };

  const { data: updated, error } = await supabase
    .from("store_settings")
    .update(values)
    .eq("id", true)
    .eq("updated_at", version)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.message === "settings:invalid_timezone") {
      return result("error", { fieldErrors: { timezone: "timezoneInvalid" } });
    }
    log("update settings", error);
    if (error.code === "42501") return result("error", { error: "forbidden" });
    return result("error", { error: error.code ? "unexpected" : "network" });
  }
  if (!updated) return result("error", { error: "conflict" });

  const warning = await saveLogo(supabase, upload, logoType, removeLogo, current.logo_path);
  refresh();
  return result("success", { warning });
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function removeObject(supabase: Supabase, path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(STORE_ASSETS_BUCKET).remove([path]);
  if (error) console.error(`[settings] logo cleanup failed: path=${path}`);
  return !error;
}

async function saveLogo(
  supabase: Supabase,
  upload: File | null,
  type: { contentType: string; ext: string } | null,
  remove: boolean,
  previousPath: string | null,
): Promise<SettingsWarning | undefined> {
  if (upload && type) {
    const path = `logo/${randomUUID()}.${type.ext}`;
    const bucket = supabase.storage.from(STORE_ASSETS_BUCKET);
    const { error: uploadError } = await bucket.upload(path, upload, {
      contentType: type.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) {
      console.error(`[settings] logo upload failed: ${uploadError.message}`);
      return "logoUploadFailed";
    }
    const { error } = await supabase
      .from("store_settings")
      .update({ logo_path: path, logo_url: bucket.getPublicUrl(path).data.publicUrl })
      .eq("id", true);
    if (error) {
      log("link logo", error);
      await removeObject(supabase, path);
      return "logoUploadFailed";
    }
    if (previousPath && !(await removeObject(supabase, previousPath))) return "logoCleanupFailed";
    return undefined;
  }

  if (remove && previousPath) {
    const { error } = await supabase
      .from("store_settings")
      .update({ logo_path: null, logo_url: null })
      .eq("id", true);
    if (error) {
      log("remove logo", error);
      return "logoUploadFailed";
    }
    if (!(await removeObject(supabase, previousPath))) return "logoCleanupFailed";
  }
  return undefined;
}
