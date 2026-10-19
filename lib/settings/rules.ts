// Store settings rules, shared by the settings form (instant feedback) and the
// Server Action (authoritative). The store_settings constraints and trigger
// (migration 020) remain the final protection.

import { isLocale } from "@/config/i18n";
import { selectableCountries } from "@/config/region";
import { parseWholeNumber } from "@/lib/inventory/rules";
import { normalizeNumberInput, parseMoney, type MoneyError } from "@/lib/money";

export const STORE_NAME_MAX_LENGTH = 200;
export const EMAIL_MAX_LENGTH = 254;
export const PHONE_MAX_LENGTH = 32;
export const ADDRESS_LINE_MAX_LENGTH = 200;
export const CITY_MAX_LENGTH = 100;
export const POSTAL_CODE_MAX_LENGTH = 20;
export const TAX_NUMBER_MAX_LENGTH = 50;
export const MAX_DELIVERY_DAYS = 365;
export const MAX_QUANTITY_PER_ITEM = 10000;
export const SOCIAL_URL_MAX_LENGTH = 500;

/** Days in stored order (store_settings.business_hours keys, migration 030). */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** One day's opening hours as stored; null = closed. Times are "HH:MM". */
export type StoredDayHours = { open: string; close: string } | null;
export type BusinessHours = Record<Weekday, StoredDayHours>;

/**
 * Social profiles (one store_settings column each, social_<platform>). A link
 * must point at one of the platform's own domains; "@handle" is turned into
 * the profile link.
 */
export const SOCIAL_PLATFORMS = {
  instagram: { domains: ["instagram.com"], profile: (h: string) => `instagram.com/${h}` },
  facebook: {
    domains: ["facebook.com", "fb.com", "fb.me"],
    profile: (h: string) => `facebook.com/${h}`,
  },
  tiktok: { domains: ["tiktok.com"], profile: (h: string) => `tiktok.com/@${h}` },
  snapchat: { domains: ["snapchat.com"], profile: (h: string) => `snapchat.com/add/${h}` },
  x: { domains: ["x.com", "twitter.com"], profile: (h: string) => `x.com/${h}` },
  youtube: { domains: ["youtube.com", "youtu.be"], profile: (h: string) => `youtube.com/@${h}` },
} as const;
export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;
export const SOCIAL_KEYS = Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[];

/** Same patterns as the store_settings CHECK constraints. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{6,32}$/;
const WHATSAPP_PATTERN = /^\+[0-9 ()-]{6,32}$/;
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
// "@mirna.ae" or "mirna" (no dot) is a handle; "mirna.ae" is read as a link.
const HANDLE_PATTERN = /^(@[\w.-]{1,100}|[\w-]{1,100})$/;
const TAX_RATE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/** Every ISO 4217 currency the runtime knows (no hand-kept list). */
export function currencyOptions(): string[] {
  return Intl.supportedValuesOf("currency");
}

/** Every IANA timezone the runtime knows. */
export function timezoneOptions(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value) && currencyOptions().includes(value);
}

export function isTimezone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface SettingsInput {
  storeName: string;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  defaultLocale: string;
  taxEnabled: boolean;
  taxRate: string;
  pricesIncludeTax: boolean;
  taxRegistrationNumber: string;
  shippingFee: string;
  freeShippingThreshold: string;
  deliveryMinDays: string;
  deliveryMaxDays: string;
  minOrderAmount: string;
  maxQuantityPerItem: string;
  allowCustomerCancellation: boolean;
  notifyNewOrder: boolean;
  notifyLowStock: boolean;
  notifyOrderCancelled: boolean;
  notificationEmail: string;
  // Contact information (migration 030). `contactExtras` is false while 030
  // isn't applied: the fields are hidden and not saved.
  contactExtras: boolean;
  contactWhatsapp: string;
  contactPublished: boolean;
  hoursEnabled: boolean;
  hours: Record<Weekday, { open: boolean; from: string; to: string }>;
  social: Record<SocialPlatform, string>;
}

/** Field names used for errors and focus: plain fields, "hours.mon", "social.x". */
export type SettingsField =
  | Exclude<keyof SettingsInput, "hours" | "social" | "contactExtras">
  | `hours.${Weekday}`
  | `social.${SocialPlatform}`;

export type SettingsError =
  | "storeNameRequired"
  | "tooLong"
  | "emailInvalid"
  | "phoneInvalid"
  | "countryInvalid"
  | "currencyInvalid"
  | "timezoneInvalid"
  | "localeInvalid"
  | "taxRateInvalid"
  | "taxRateRequired"
  | "daysInvalid"
  | "daysOrder"
  | "quantityInvalid"
  | "whatsappInvalid"
  | "timeInvalid"
  | "timeSame"
  | "socialInvalid"
  | MoneyError;

export type SettingsFieldErrors = Partial<Record<SettingsField, SettingsError>>;

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const flag = (data: FormData, name: string) => data.get(name) === "on";

export function readSettings(data: FormData): SettingsInput {
  return {
    storeName: text(data, "storeName"),
    contactEmail: text(data, "contactEmail"),
    contactPhone: text(data, "contactPhone"),
    addressLine1: text(data, "addressLine1"),
    addressLine2: text(data, "addressLine2"),
    city: text(data, "city"),
    stateRegion: text(data, "stateRegion"),
    postalCode: text(data, "postalCode"),
    countryCode: text(data, "countryCode"),
    currencyCode: text(data, "currencyCode"),
    timezone: text(data, "timezone"),
    defaultLocale: text(data, "defaultLocale"),
    taxEnabled: flag(data, "taxEnabled"),
    taxRate: text(data, "taxRate"),
    pricesIncludeTax: flag(data, "pricesIncludeTax"),
    taxRegistrationNumber: text(data, "taxRegistrationNumber"),
    shippingFee: text(data, "shippingFee"),
    freeShippingThreshold: text(data, "freeShippingThreshold"),
    deliveryMinDays: text(data, "deliveryMinDays"),
    deliveryMaxDays: text(data, "deliveryMaxDays"),
    minOrderAmount: text(data, "minOrderAmount"),
    maxQuantityPerItem: text(data, "maxQuantityPerItem"),
    allowCustomerCancellation: flag(data, "allowCustomerCancellation"),
    notifyNewOrder: flag(data, "notifyNewOrder"),
    notifyLowStock: flag(data, "notifyLowStock"),
    notifyOrderCancelled: flag(data, "notifyOrderCancelled"),
    notificationEmail: text(data, "notificationEmail"),
    contactExtras: flag(data, "contactExtras"),
    contactWhatsapp: text(data, "contactWhatsapp"),
    contactPublished: flag(data, "contactPublished"),
    hoursEnabled: flag(data, "hoursEnabled"),
    hours: Object.fromEntries(
      WEEKDAYS.map((day) => [
        day,
        {
          open: flag(data, `hours.${day}.open`),
          from: text(data, `hours.${day}.from`),
          to: text(data, `hours.${day}.to`),
        },
      ]),
    ) as SettingsInput["hours"],
    social: Object.fromEntries(
      SOCIAL_KEYS.map((key) => [key, text(data, `social.${key}`)]),
    ) as SettingsInput["social"],
  };
}

/** Business hours as stored, or null when hours aren't shown. Assumes valid input. */
export function toBusinessHours(input: SettingsInput): BusinessHours | null {
  if (!input.hoursEnabled) return null;
  return Object.fromEntries(
    WEEKDAYS.map((day) => {
      const hours = input.hours[day];
      return [day, hours.open ? { open: hours.from, close: hours.to } : null];
    }),
  ) as BusinessHours;
}

/**
 * A social profile link as stored ("https://instagram.com/mirna"), or null if
 * it isn't a link to that platform. Accepts a full link, one without
 * "https://", or an @handle.
 */
export function normalizeSocialUrl(raw: string, platform: SocialPlatform): string | null {
  const value = raw.trim();
  if (!value) return null;
  const rules = SOCIAL_PLATFORMS[platform];
  const candidate = HANDLE_PATTERN.test(value)
    ? rules.profile(value.replace(/^@/, ""))
    : value.replace(/^http:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const domains: readonly string[] = rules.domains;
  if (!domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
  const href = url.href.replace(/\/$/, "");
  return href.length > SOCIAL_URL_MAX_LENGTH ? null : href;
}

/** Phone as stored: Arabic-Indic / Persian digits become 0-9; spacing is kept. */
export function normalizePhone(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Tax rate as a decimal string (e.g. "5" or "7.5"), or null if invalid. */
export function parseTaxRate(raw: string): string | null {
  const value = normalizeNumberInput(raw);
  if (!TAX_RATE_PATTERN.test(value) || Number(value) > 100) return null;
  return value;
}

function validateEmail(value: string): SettingsError | undefined {
  if (!value) return undefined;
  if (value.length > EMAIL_MAX_LENGTH) return "tooLong";
  if (!EMAIL_PATTERN.test(value)) return "emailInvalid";
}

function validateTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

function maxLength(value: string, max: number): SettingsError | undefined {
  return value.length > max ? "tooLong" : undefined;
}

export function validateSettings(input: SettingsInput): SettingsFieldErrors {
  const errors: SettingsFieldErrors = {};

  if (!input.storeName) errors.storeName = "storeNameRequired";
  else errors.storeName = maxLength(input.storeName, STORE_NAME_MAX_LENGTH);

  errors.contactEmail = validateEmail(input.contactEmail);
  errors.notificationEmail = validateEmail(input.notificationEmail);
  if (input.contactPhone && !PHONE_PATTERN.test(normalizePhone(input.contactPhone))) {
    errors.contactPhone = "phoneInvalid";
  }

  errors.addressLine1 = maxLength(input.addressLine1, ADDRESS_LINE_MAX_LENGTH);
  errors.addressLine2 = maxLength(input.addressLine2, ADDRESS_LINE_MAX_LENGTH);
  errors.city = maxLength(input.city, CITY_MAX_LENGTH);
  errors.stateRegion = maxLength(input.stateRegion, CITY_MAX_LENGTH);
  errors.postalCode = maxLength(input.postalCode, POSTAL_CODE_MAX_LENGTH);
  errors.taxRegistrationNumber = maxLength(input.taxRegistrationNumber, TAX_NUMBER_MAX_LENGTH);

  if (!selectableCountries.includes(input.countryCode)) errors.countryCode = "countryInvalid";
  if (!isTimezone(input.timezone)) errors.timezone = "timezoneInvalid";
  if (!isLocale(input.defaultLocale)) errors.defaultLocale = "localeInvalid";

  const taxRate = input.taxRate ? parseTaxRate(input.taxRate) : "0";
  if (taxRate === null) errors.taxRate = "taxRateInvalid";
  else if (input.taxEnabled && Number(taxRate) === 0) errors.taxRate = "taxRateRequired";

  const minDays = parseWholeNumber(input.deliveryMinDays);
  const maxDays = parseWholeNumber(input.deliveryMaxDays);
  if (minDays === null || minDays > MAX_DELIVERY_DAYS) errors.deliveryMinDays = "daysInvalid";
  if (maxDays === null || maxDays > MAX_DELIVERY_DAYS) errors.deliveryMaxDays = "daysInvalid";
  else if (minDays !== null && minDays > maxDays) errors.deliveryMaxDays = "daysOrder";

  const quantity = parseWholeNumber(input.maxQuantityPerItem);
  if (quantity === null || quantity < 1 || quantity > MAX_QUANTITY_PER_ITEM) {
    errors.maxQuantityPerItem = "quantityInvalid";
  }

  if (input.contactExtras) {
    if (input.contactWhatsapp && !WHATSAPP_PATTERN.test(normalizePhone(input.contactWhatsapp))) {
      errors.contactWhatsapp = "whatsappInvalid";
    }
    if (input.hoursEnabled) {
      for (const day of WEEKDAYS) {
        const hours = input.hours[day];
        if (!hours.open) continue;
        if (!validateTime(hours.from) || !validateTime(hours.to))
          errors[`hours.${day}`] = "timeInvalid";
        else if (hours.from === hours.to) errors[`hours.${day}`] = "timeSame";
      }
    }
    for (const key of SOCIAL_KEYS) {
      if (input.social[key] && !normalizeSocialUrl(input.social[key], key)) {
        errors[`social.${key}`] = "socialInvalid";
      }
    }
  }

  // Amounts follow the selected currency's decimal places.
  if (!isCurrencyCode(input.currencyCode)) {
    errors.currencyCode = "currencyInvalid";
  } else {
    const fee = parseMoney(input.shippingFee || "0", input.currencyCode);
    if (!fee.ok) errors.shippingFee = fee.error;
    for (const key of ["freeShippingThreshold", "minOrderAmount"] as const) {
      if (!input[key]) continue;
      const amount = parseMoney(input[key], input.currencyCode);
      if (!amount.ok) errors[key] = amount.error;
    }
  }

  for (const key of Object.keys(errors) as SettingsField[]) {
    if (errors[key] === undefined) delete errors[key];
  }
  return errors;
}
