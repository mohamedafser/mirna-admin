"use client";

import {
  Bell,
  CircleCheck,
  Clock,
  Globe2,
  LoaderCircle,
  MapPin,
  Percent,
  Phone,
  Receipt,
  Save,
  Share2,
  Store,
  Trash2,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { ImageDropzone } from "@/components/catalogue/image-dropzone";
import { useUnsavedChanges } from "@/components/catalogue/use-unsaved-changes";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IconBadge } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { localeConfig, locales } from "@/config/i18n";
import { selectableCountries } from "@/config/region";
import { validateImageFile } from "@/lib/catalogue/images";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import { currencyFractionDigits, moneyInputValue } from "@/lib/money";
import { saveSettings, type SettingsFormResult } from "@/lib/settings/actions";
import { cn } from "@/lib/utils/cn";
import { BusinessHoursFields } from "./business-hours-fields";
import { SettingsNav, type SettingsNavItem } from "./settings-nav";
import type { StoreSettings } from "@/lib/settings/queries";
import {
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  currencyOptions,
  EMAIL_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  POSTAL_CODE_MAX_LENGTH,
  readSettings,
  SOCIAL_KEYS,
  SOCIAL_URL_MAX_LENGTH,
  STORE_NAME_MAX_LENGTH,
  TAX_NUMBER_MAX_LENGTH,
  timezoneOptions,
  validateSettings,
  WEEKDAYS,
  type SettingsError,
  type SettingsFieldErrors,
  type SocialPlatform,
} from "@/lib/settings/rules";

/** Brand names, shown as-is in every language. */
const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  x: "X (Twitter)",
  youtube: "YouTube",
};

const initialState: SettingsFormResult = { status: "idle", fieldErrors: {}, at: 0 };

type SectionId =
  | "store"
  | "contact"
  | "address"
  | "hours"
  | "social"
  | "market"
  | "tax"
  | "shipping"
  | "orders"
  | "notifications";

/** Which section shows each field, so the nav can flag sections with errors. */
function sectionOf(field: string): SectionId {
  if (field.startsWith("hours.")) return "hours";
  if (field.startsWith("social.")) return "social";
  if (field === "storeName" || field === "logo") return "store";
  if (field.startsWith("contact")) return "contact";
  if (["addressLine1", "addressLine2", "city", "stateRegion", "postalCode"].includes(field)) {
    return "address";
  }
  if (["countryCode", "currencyCode", "timezone", "defaultLocale"].includes(field)) return "market";
  if (field.startsWith("tax")) return "tax";
  if (
    field.startsWith("shipping") ||
    field.startsWith("freeShipping") ||
    field.startsWith("delivery")
  ) {
    return "shipping";
  }
  if (field === "notificationEmail") return "notifications";
  return "orders";
}

/** A settings card: same header as the admin's other cards (tinted icon, caps title). */
function Section({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: SectionId;
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      id={id}
      className="grid min-w-0 scroll-mt-32 gap-5 rounded-2xl border bg-card p-5 sm:p-6 lg:scroll-mt-24"
    >
      <legend className="float-start w-full">
        <span className="flex items-start gap-3">
          <IconBadge icon={icon} />
          <span className="min-w-0 flex-1">
            <span className="caps block text-xs leading-tight font-medium">{title}</span>
            {description && (
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                {description}
              </span>
            )}
          </span>
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

/** A setting that is on or off: label and hint on one side, a switch on the other. */
function Toggle({
  name,
  label,
  hint,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-3.5 py-3 text-sm transition-colors hover:bg-accent/40 has-disabled:cursor-not-allowed">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
      />
    </label>
  );
}

/**
 * Store settings: one form for the single store_settings row. Reloads from
 * the server's version after a save (or someone else's) when there are no
 * unsaved edits; with unsaved edits, saving reports the conflict instead of
 * overwriting.
 */
export function SettingsForm({ settings }: { settings: StoreSettings }) {
  const [snapshot, setSnapshot] = useState(settings);
  const [dirty, setDirty] = useState(false);
  // Bumped by "Discard changes": remounting the fields restores the saved values.
  const [revision, setRevision] = useState(0);
  useUnsavedChanges(dirty);
  if (settings.updated_at !== snapshot.updated_at && !dirty) setSnapshot(settings);

  return (
    <SettingsFields
      key={`${snapshot.updated_at}-${revision}`}
      settings={snapshot}
      dirty={dirty}
      setDirty={setDirty}
      onDiscard={() => {
        setDirty(false);
        setRevision((value) => value + 1);
      }}
    />
  );
}

function SettingsFields({
  settings,
  dirty,
  setDirty,
  onDiscard,
}: {
  settings: StoreSettings;
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  onDiscard: () => void;
}) {
  const { locale, messages } = useI18n();
  const t = messages.settings;
  const f = t.fields;
  const toast = useToast();
  const id = useId();
  const formId = `${id}-form`;
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const [clientErrors, setClientErrors] = useState<SettingsFormResult["fieldErrors"] | null>(null);
  const [currency, setCurrency] = useState(settings.currency_code);
  const [taxEnabled, setTaxEnabled] = useState(settings.tax_enabled);
  const [hoursEnabled, setHoursEnabled] = useState(settings.business_hours !== null);
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  const fieldErrors = clientErrors ?? state.fieldErrors;
  const errorText = (code?: SettingsError | SettingsFormResult["fieldErrors"]["logo"]) => {
    if (!code) return undefined;
    if (code === "moneyTooManyDecimals") {
      return format(t.errors.moneyTooManyDecimals, { digits: currencyFractionDigits(currency) });
    }
    if (code === "imageType" || code === "imageSize" || code === "imageEmpty") {
      return messages.catalogue.errors[code];
    }
    return t.errors[code];
  };

  // Option lists come from Intl (names in the UI language), not hand-kept lists.
  const options = useMemo(() => {
    const regionNames = new Intl.DisplayNames([locale], { type: "region" });
    const currencyNames = new Intl.DisplayNames([locale], { type: "currency" });
    return {
      countries: selectableCountries.map((code) => ({
        value: code,
        label: `${regionNames.of(code) ?? code} (${code})`,
      })),
      currencies: currencyOptions().map((code) => ({
        value: code,
        label: `${code} · ${currencyNames.of(code) ?? code}`,
      })),
      timezones: timezoneOptions().map((zone) => ({ value: zone, label: zone })),
      locales: locales.map((code) => ({ value: code, label: localeConfig[code].nativeName })),
    };
  }, [locale]);

  function chooseLogo(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
    setLogo(file);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (logo) data.set("logo", logo);
    if (removeLogo) data.set("removeLogo", "on");

    const errors: SettingsFormResult["fieldErrors"] = validateSettings(readSettings(data));
    const logoError = logo ? validateImageFile(logo) : null;
    if (logoError) errors.logo = logoError;
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      const first = Object.keys(errors)[0];
      form.querySelector<HTMLElement>(`[data-field="${first}"], [name="${first}"]`)?.focus();
      return;
    }
    setClientErrors(null);
    startTransition(async () => {
      const result = await saveSettings(state, data);
      setState(result);
      if (result.status !== "success") return;
      setDirty(false);
      if (preview) URL.revokeObjectURL(preview);
      if (result.warning) toast.warning(t.errors[result.warning]);
      else toast.success(t.saved);
    });
  }

  const money = (value: string | null) => (value === null ? "" : moneyInputValue(value, currency));
  const currentLogo = removeLogo ? null : (preview ?? settings.logo_url);

  const text = (
    name: keyof SettingsFieldErrors,
    label: string,
    value: string | null,
    props: {
      maxLength?: number;
      hint?: string;
      optional?: boolean;
      dir?: "ltr";
      type?: string;
      inputMode?: "decimal" | "numeric" | "tel" | "email" | "url";
      autoComplete?: string;
      placeholder?: string;
      disabled?: boolean;
    } = {},
  ) => (
    <Field
      id={`${id}-${name}`}
      label={label}
      hint={props.hint}
      optional={props.optional ? messages.catalogue.common.optional : undefined}
      error={errorText(fieldErrors[name])}
    >
      {(a11y) => (
        <Input
          {...a11y}
          name={name}
          defaultValue={value ?? ""}
          maxLength={props.maxLength}
          dir={props.dir}
          type={props.type}
          inputMode={props.inputMode}
          autoComplete={props.autoComplete ?? "off"}
          placeholder={props.placeholder}
          disabled={pending || props.disabled}
        />
      )}
    </Field>
  );

  const select = (
    name: keyof SettingsFieldErrors,
    label: string,
    choices: { value: string; label: string }[],
    props: { value?: string; defaultValue?: string; onChange?: (v: string) => void; hint?: string },
  ) => (
    <Field
      id={`${id}-${name}`}
      label={label}
      hint={props.hint}
      error={errorText(fieldErrors[name])}
    >
      {(a11y) => (
        <Combobox
          {...a11y}
          name={name}
          dataField={name}
          options={choices}
          value={props.value}
          defaultValue={props.defaultValue}
          disabled={pending}
          onChange={(value) => {
            props.onChange?.(value);
            setDirty(true);
          }}
        />
      )}
    </Field>
  );

  // Section nav: hours and social only exist with the contact extras (migration 030).
  const invalid = new Set(Object.keys(fieldErrors).map(sectionOf));
  const groups = t.groups;
  const navItems: SettingsNavItem[] = (
    [
      ["store", Store, groups.storefront],
      ["contact", Phone, groups.storefront],
      ["address", MapPin, groups.storefront],
      ...(settings.contactExtras
        ? ([
            ["hours", Clock, groups.storefront],
            ["social", Share2, groups.storefront],
          ] as const)
        : []),
      ["market", Globe2, groups.selling],
      ["tax", Percent, groups.selling],
      ["shipping", Truck, groups.selling],
      ["orders", Receipt, groups.selling],
      ["notifications", Bell, groups.alerts],
    ] as const
  ).map(([sectionId, icon, group]) => ({
    id: sectionId,
    icon,
    group,
    label: t.sections[sectionId],
    hasError: invalid.has(sectionId),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <SettingsNav items={navItems} label={t.navLabel} errorLabel={t.sectionHasErrors} />

      <div className="grid min-w-0 gap-4">
        {state.error && !pending && <Alert>{t.errors[state.error]}</Alert>}
        {invalid.size > 0 && !pending && (
          <Alert>{format(t.fixErrors, { count: invalid.size })}</Alert>
        )}

        <form
          id={formId}
          onSubmit={onSubmit}
          onChange={() => setDirty(true)}
          noValidate
          aria-busy={pending}
          className="grid gap-4"
        >
          <input type="hidden" name="updatedAt" value={settings.updated_at} readOnly />

          <Section id="store" icon={Store} title={t.sections.store}>
            {text("storeName", f.storeName, settings.store_name, {
              maxLength: STORE_NAME_MAX_LENGTH,
            })}
            <div className="grid gap-2">
              <span className="text-sm font-medium">{f.logo}</span>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <CatalogueImage
                  src={currentLogo}
                  alt={currentLogo ? f.logoAlt : ""}
                  sizes="96px"
                  className="size-24 bg-background [&_img]:object-contain [&_img]:p-2"
                />
                <div className="grid min-w-0 flex-1 gap-2">
                  <ImageDropzone
                    disabled={pending}
                    prompt={messages.catalogue.images.dropzone}
                    browseLabel={settings.logo_url || logo ? f.replaceLogo : f.chooseLogo}
                    activeLabel={messages.catalogue.images.dropActive}
                    hint={f.logoHint}
                    onFiles={([file]) => {
                      chooseLogo(file);
                      setRemoveLogo(false);
                      setDirty(true);
                      setClientErrors((errors) => ({
                        ...errors,
                        logo: validateImageFile(file) ?? undefined,
                      }));
                    }}
                  />
                  {fieldErrors.logo && (
                    <p role="alert" className="text-sm text-error">
                      {errorText(fieldErrors.logo)}
                    </p>
                  )}
                  {(logo || settings.logo_url) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {logo && (
                        <span className="truncate text-xs text-muted-foreground">{logo.name}</span>
                      )}
                      {removeLogo ? (
                        <>
                          <span className="text-xs text-muted-foreground">{f.logoRemoved}</span>
                          <Button variant="ghost" size="sm" onClick={() => setRemoveLogo(false)}>
                            <Undo2 aria-hidden />
                            {f.undoRemove}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-error hover:text-error"
                          disabled={pending}
                          onClick={() => {
                            if (logo) chooseLogo(null);
                            else setRemoveLogo(true);
                            setDirty(true);
                          }}
                        >
                          <Trash2 aria-hidden />
                          {f.removeLogo}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {settings.contactExtras && (
            <input type="hidden" name="contactExtras" value="on" readOnly />
          )}

          <Section
            id="contact"
            icon={Phone}
            title={t.sections.contact}
            description={settings.contactExtras ? t.contactPublicHint : t.contactHint}
          >
            {settings.contactExtras && (
              <div>
                <Toggle
                  name="contactPublished"
                  label={f.contactPublished}
                  hint={f.contactPublishedHint}
                  defaultChecked={settings.contact_published}
                  disabled={pending}
                />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("contactEmail", f.contactEmail, settings.contact_email, {
                optional: true,
                type: "email",
                inputMode: "email",
                dir: "ltr",
                maxLength: EMAIL_MAX_LENGTH,
              })}
              {text("contactPhone", f.contactPhone, settings.contact_phone, {
                optional: true,
                type: "tel",
                inputMode: "tel",
                dir: "ltr",
                maxLength: PHONE_MAX_LENGTH,
                placeholder: "+971 4 000 0000",
              })}
              {settings.contactExtras &&
                text("contactWhatsapp", f.contactWhatsapp, settings.contact_whatsapp, {
                  optional: true,
                  type: "tel",
                  inputMode: "tel",
                  dir: "ltr",
                  maxLength: PHONE_MAX_LENGTH,
                  placeholder: "+971 50 000 0000",
                  hint: f.contactWhatsappHint,
                })}
            </div>
          </Section>

          <Section
            id="address"
            icon={MapPin}
            title={t.sections.address}
            description={settings.contactExtras ? t.addressHint : undefined}
          >
            {text("addressLine1", f.addressLine1, settings.address_line1, {
              optional: true,
              maxLength: ADDRESS_LINE_MAX_LENGTH,
            })}
            {text("addressLine2", f.addressLine2, settings.address_line2, {
              optional: true,
              maxLength: ADDRESS_LINE_MAX_LENGTH,
            })}
            <div className="grid gap-4 sm:grid-cols-3">
              {text("city", f.city, settings.city, { optional: true, maxLength: CITY_MAX_LENGTH })}
              {text("stateRegion", f.stateRegion, settings.state_region, {
                optional: true,
                maxLength: CITY_MAX_LENGTH,
              })}
              {text("postalCode", f.postalCode, settings.postal_code, {
                optional: true,
                dir: "ltr",
                maxLength: POSTAL_CODE_MAX_LENGTH,
              })}
            </div>
          </Section>

          {settings.contactExtras && (
            <Section id="hours" icon={Clock} title={t.sections.hours} description={t.hoursHint}>
              <Toggle
                name="hoursEnabled"
                label={f.hoursEnabled}
                hint={f.hoursEnabledHint}
                checked={hoursEnabled}
                onChange={setHoursEnabled}
                disabled={pending}
              />
              {/* Hidden (not unmounted) so turning hours off and on keeps the edits. */}
              <div hidden={!hoursEnabled}>
                <BusinessHoursFields
                  saved={settings.business_hours}
                  disabled={pending || !hoursEnabled}
                  errors={Object.fromEntries(
                    WEEKDAYS.map((day) => [day, errorText(fieldErrors[`hours.${day}`])]),
                  )}
                  onChange={() => setDirty(true)}
                />
              </div>
            </Section>
          )}

          {settings.contactExtras && (
            <Section id="social" icon={Share2} title={t.sections.social} description={t.socialHint}>
              <div className="grid gap-4 sm:grid-cols-2">
                {SOCIAL_KEYS.map((key) => (
                  <div key={key}>
                    {text(`social.${key}`, SOCIAL_LABELS[key], settings[`social_${key}`], {
                      optional: true,
                      dir: "ltr",
                      inputMode: "url",
                      maxLength: SOCIAL_URL_MAX_LENGTH,
                      placeholder: f.socialPlaceholder,
                    })}
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section id="market" icon={Globe2} title={t.sections.market} description={t.marketHint}>
            <div className="grid gap-4 sm:grid-cols-2">
              {select("countryCode", f.country, options.countries, {
                defaultValue: settings.country_code,
              })}
              {select("currencyCode", f.currency, options.currencies, {
                value: currency,
                onChange: setCurrency,
                hint: f.currencyHint,
              })}
              {select("timezone", f.timezone, options.timezones, {
                defaultValue: settings.timezone,
              })}
              {select("defaultLocale", f.defaultLocale, options.locales, {
                defaultValue: settings.default_locale,
                hint: f.defaultLocaleHint,
              })}
            </div>
          </Section>

          <Section id="tax" icon={Percent} title={t.sections.tax}>
            <Toggle
              name="taxEnabled"
              label={f.taxEnabled}
              hint={f.taxEnabledHint}
              checked={taxEnabled}
              onChange={setTaxEnabled}
              disabled={pending}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {text("taxRate", f.taxRate, settings.tax_rate.replace(/\.?0+$/, ""), {
                inputMode: "decimal",
                dir: "ltr",
                hint: f.taxRateHint,
                disabled: !taxEnabled,
              })}
              {text(
                "taxRegistrationNumber",
                f.taxRegistrationNumber,
                settings.tax_registration_number,
                { optional: true, dir: "ltr", maxLength: TAX_NUMBER_MAX_LENGTH },
              )}
            </div>
            {/* A disabled input isn't submitted; keep the stored rate. */}
            {!taxEnabled && <input type="hidden" name="taxRate" value={settings.tax_rate} />}
            <Toggle
              name="pricesIncludeTax"
              label={f.pricesIncludeTax}
              hint={f.pricesIncludeTaxHint}
              defaultChecked={settings.prices_include_tax}
              disabled={pending}
            />
          </Section>

          <Section
            id="shipping"
            icon={Truck}
            title={t.sections.shipping}
            description={t.storedHint}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text(
                "shippingFee",
                format(f.shippingFee, { currency }),
                money(settings.shipping_fee),
                {
                  inputMode: "decimal",
                  dir: "ltr",
                  placeholder: "0",
                  hint: f.shippingFeeHint,
                },
              )}
              {text(
                "freeShippingThreshold",
                format(f.freeShippingThreshold, { currency }),
                money(settings.free_shipping_threshold),
                { inputMode: "decimal", dir: "ltr", optional: true, hint: f.freeShippingHint },
              )}
              {text("deliveryMinDays", f.deliveryMinDays, String(settings.delivery_min_days), {
                inputMode: "numeric",
                dir: "ltr",
              })}
              {text("deliveryMaxDays", f.deliveryMaxDays, String(settings.delivery_max_days), {
                inputMode: "numeric",
                dir: "ltr",
              })}
            </div>
          </Section>

          <Section id="orders" icon={Receipt} title={t.sections.orders} description={t.storedHint}>
            <div className="grid gap-4 sm:grid-cols-2">
              {text(
                "minOrderAmount",
                format(f.minOrderAmount, { currency }),
                money(settings.min_order_amount),
                { inputMode: "decimal", dir: "ltr", optional: true, hint: f.minOrderHint },
              )}
              {text(
                "maxQuantityPerItem",
                f.maxQuantityPerItem,
                String(settings.max_quantity_per_item),
                {
                  inputMode: "numeric",
                  dir: "ltr",
                  hint: f.maxQuantityHint,
                },
              )}
            </div>
            <Toggle
              name="allowCustomerCancellation"
              label={f.allowCustomerCancellation}
              hint={f.allowCustomerCancellationHint}
              defaultChecked={settings.allow_customer_cancellation}
              disabled={pending}
            />
          </Section>

          <Section
            id="notifications"
            icon={Bell}
            title={t.sections.notifications}
            description={t.notificationsHint}
          >
            {text("notificationEmail", f.notificationEmail, settings.notification_email, {
              optional: true,
              type: "email",
              inputMode: "email",
              dir: "ltr",
              maxLength: EMAIL_MAX_LENGTH,
              hint: f.notificationEmailHint,
            })}
            <div className="grid gap-3">
              <Toggle
                name="notifyNewOrder"
                label={f.notifyNewOrder}
                defaultChecked={settings.notify_new_order}
                disabled={pending}
              />
              <Toggle
                name="notifyOrderCancelled"
                label={f.notifyOrderCancelled}
                defaultChecked={settings.notify_order_cancelled}
                disabled={pending}
              />
              <Toggle
                name="notifyLowStock"
                label={f.notifyLowStock}
                defaultChecked={settings.notify_low_stock}
                disabled={pending}
              />
            </div>
          </Section>
        </form>

        <div
          className={cn(
            "sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md transition-colors sm:mx-0 sm:rounded-2xl sm:border",
            dirty ? "border-primary/30 bg-brand-soft/95" : "bg-background/90",
          )}
        >
          <span role="status" className="me-auto flex min-w-0 items-center gap-2 text-sm">
            {dirty ? (
              <>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
                <span className="truncate font-medium">{messages.catalogue.common.unsaved}</span>
              </>
            ) : (
              <>
                <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
                <span className="truncate text-muted-foreground">{t.allSaved}</span>
              </>
            )}
          </span>
          {dirty && (
            <Button variant="ghost" disabled={pending} onClick={onDiscard}>
              <Undo2 aria-hidden />
              {t.discard}
            </Button>
          )}
          <Button type="submit" form={formId} disabled={pending || !dirty} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
            {pending ? messages.catalogue.common.saving : messages.catalogue.common.saveChanges}
          </Button>
        </div>
      </div>
    </div>
  );
}
