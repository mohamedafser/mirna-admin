"use client";

import {
  Bell,
  Coins,
  Globe2,
  LoaderCircle,
  MapPin,
  Percent,
  Phone,
  Receipt,
  Save,
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
import { Combobox } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { localeConfig, locales } from "@/config/i18n";
import { selectableCountries } from "@/config/region";
import { validateImageFile } from "@/lib/catalogue/images";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import { currencyFractionDigits, moneyInputValue } from "@/lib/money";
import { saveSettings, type SettingsFormResult } from "@/lib/settings/actions";
import type { StoreSettings } from "@/lib/settings/queries";
import {
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  currencyOptions,
  EMAIL_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  POSTAL_CODE_MAX_LENGTH,
  readSettings,
  STORE_NAME_MAX_LENGTH,
  TAX_NUMBER_MAX_LENGTH,
  timezoneOptions,
  validateSettings,
  type SettingsError,
  type SettingsFieldErrors,
} from "@/lib/settings/rules";

const initialState: SettingsFormResult = { status: "idle", fieldErrors: {}, at: 0 };

function Section({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset id={id} className="grid scroll-mt-20 gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <legend className="float-start mb-1 w-full">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {title}
        </span>
        {description && (
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {description}
          </span>
        )}
      </legend>
      {children}
    </fieldset>
  );
}

/** Checkbox with a label and hint (same pattern as the product "Active" box). */
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
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
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
  useUnsavedChanges(dirty);
  if (settings.updated_at !== snapshot.updated_at && !dirty) setSnapshot(settings);

  return (
    <SettingsFields
      key={snapshot.updated_at}
      settings={snapshot}
      dirty={dirty}
      setDirty={setDirty}
    />
  );
}

function SettingsFields({
  settings,
  dirty,
  setDirty,
}: {
  settings: StoreSettings;
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
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
      inputMode?: "decimal" | "numeric" | "tel" | "email";
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

  return (
    <div className="grid gap-4">
      {state.error && !pending && <Alert>{t.errors[state.error]}</Alert>}

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

        <Section id="contact" icon={Phone} title={t.sections.contact} description={t.contactHint}>
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
          </div>
        </Section>

        <Section id="address" icon={MapPin} title={t.sections.address}>
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

        <Section id="shipping" icon={Truck} title={t.sections.shipping} description={t.storedHint}>
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

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t bg-background/90 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border">
        <span className="me-auto flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Coins aria-hidden className="size-3.5 shrink-0" />
          {dirty && !pending
            ? messages.catalogue.common.unsaved
            : `${currency} · ${settings.timezone}`}
        </span>
        <Button type="submit" form={formId} disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          {pending ? messages.catalogue.common.saving : messages.catalogue.common.saveChanges}
        </Button>
      </div>
    </div>
  );
}
