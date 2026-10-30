"use client";

import { LoaderCircle, PackageCheck, Plus, RotateCw, Save, Trash2, Truck, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useUnsavedChanges } from "@/components/catalogue/use-unsaved-changes";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { minorToDecimal, parseMinor } from "@/lib/currency/money";
import { saveShippingCountry, type ShippingError } from "@/lib/shipping/actions";
import {
  bandFieldName,
  gramsToKg,
  isTiered,
  MAX_BANDS,
  methodFieldName,
  parseDays,
  readShippingForm,
  SHIPPING_RATE_TYPES,
  validateShippingForm,
  type MethodField,
  type ShippingCountryConfig,
  type ShippingFieldError,
  type ShippingMethodCode,
  type ShippingMethodConfig,
  type ShippingRateType,
  type TieredRateType,
} from "@/lib/shipping/rules";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { deliveryDays, rateLabel } from "./format";

interface BandState {
  /** Local key (stable while bands are added and removed). */
  key: string;
  /** Upper bound as typed; ignored for the last band (no upper bound). */
  upTo: string;
  amount: string;
}

interface MethodState {
  isActive: boolean;
  rateType: ShippingRateType;
  amount: string;
  bands: BandState[];
  freeShippingThreshold: string;
  minDays: string;
  maxDays: string;
}

type Currency = { code: string; decimals: number };

const METHOD_ICONS = { STANDARD: Truck, EXPRESS: Zap } as const;

/**
 * A country's delivery configuration: on/off, then Standard and Express each
 * with its own status, rate (flat, or bands of order value or parcel
 * weight), free-delivery threshold and delivery estimate, saved together in
 * one transaction. Amounts are typed in the country's currency and weights
 * in kg, and sent as minor units / grams (never floats). Bands are edited by
 * their upper bound: each starts where the previous one ends, the first at 0
 * and the last has no upper bound, so every order can be priced. A live
 * preview shows what customers will see at checkout.
 *
 * Keyed by the configuration's version on the page, so a save (or a reload
 * after a conflicting save elsewhere) starts again from the stored values.
 */
export function ShippingCountryForm({
  config,
  currency,
  countryName,
  unweighedProducts,
}: {
  config: ShippingCountryConfig;
  currency: Currency;
  countryName: string;
  /** Active products without their own weight (counted as 0 kg). */
  unweighedProducts: number;
}) {
  const { messages } = useI18n();
  const t = messages.shipping;
  const d = t.detail;
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [isActive, setIsActive] = useState(config.isActive);
  const [methods, setMethods] = useState<Record<ShippingMethodCode, MethodState>>(
    () =>
      Object.fromEntries(
        config.methods.map((method) => [method.code, toState(method, currency.decimals)]),
      ) as Record<ShippingMethodCode, MethodState>,
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, ShippingFieldError>>>({});
  const [formError, setFormError] = useState<ShippingError | null>(null);
  useUnsavedChanges(dirty);

  function update(code: ShippingMethodCode, patch: Partial<MethodState>) {
    setMethods((current) => ({ ...current, [code]: { ...current[code], ...patch } }));
    setDirty(true);
    setFormError(null);
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        delete next[methodFieldName(code, key as MethodField)];
      }
      // Fields checked against each other.
      if ("minDays" in patch) delete next[methodFieldName(code, "maxDays")];
      if ("bands" in patch || "rateType" in patch) {
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${code}.bands.`)) delete next[key];
        }
      }
      return next;
    });
  }

  function changeRateType(code: ShippingMethodCode, rateType: ShippingRateType) {
    const method = methods[code];
    // Switching between order value and weight changes the bounds' unit.
    const keepBounds = isTiered(method.rateType) && method.rateType === rateType;
    const bands =
      isTiered(rateType) && !keepBounds
        ? method.bands.length > 0 && isTiered(method.rateType)
          ? method.bands.map((band) => ({ ...band, upTo: "" }))
          : [{ key: crypto.randomUUID(), upTo: "", amount: method.amount }]
        : method.bands;
    update(code, { rateType, bands });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const checked = validateShippingForm(readShippingForm(data), currency.decimals);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setFormError(checked.formError ?? null);
      const first = Object.keys(checked.fieldErrors)[0];
      (first
        ? form.querySelector<HTMLElement>(`[data-field="${first}"], [name="${first}"]`)
        : form.querySelector<HTMLElement>('[name="isActive"]')
      )?.focus();
      return;
    }
    setFieldErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await saveShippingCountry(data);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        setFormError(result.error ?? null);
        return;
      }
      setDirty(false);
      toast.success(format(d.saved, { country: countryName }));
    });
  }

  const errorOf = (key: string) => {
    const error = fieldErrors[key];
    return error && t.fieldErrors[error];
  };
  const errorText = (code: ShippingMethodCode, field: MethodField) =>
    errorOf(methodFieldName(code, field));
  const deliverable = isActive && Object.values(methods).some((method) => method.isActive);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <input type="hidden" name="countryCode" value={config.countryCode} readOnly />
      <input type="hidden" name="updatedAt" value={config.updatedAt} readOnly />

      <div className="grid min-w-0 gap-4">
        {formError && !pending && (
          <Alert>
            <span className="flex flex-wrap items-center justify-between gap-3">
              {t.errors[formError]}
              {formError === "stale" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refreshing}
                  onClick={() => {
                    setDirty(false);
                    startRefresh(() => router.refresh());
                  }}
                >
                  <RotateCw aria-hidden className={cn(refreshing && "animate-spin")} />
                  {d.reload}
                </Button>
              )}
            </span>
          </Alert>
        )}

        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                {format(d.statusLabel, { country: countryName })}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{d.statusHint}</span>
            </span>
            <Switch
              name="isActive"
              checked={isActive}
              disabled={pending}
              onChange={(event) => {
                setIsActive(event.target.checked);
                setDirty(true);
                setFormError(null);
              }}
            />
          </label>
        </section>

        {config.methods.map(({ code }) => {
          const method = methods[code];
          const field = (name: MethodField) => methodFieldName(code, name);
          const methodName = t.methods[code];
          return (
            <fieldset
              key={code}
              disabled={pending}
              className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5"
            >
              <legend className="sr-only">{methodName}</legend>
              <CardHeader
                icon={METHOD_ICONS[code]}
                title={methodName}
                description={t.methodHints[code]}
                action={
                  // The label makes the whole control clickable (Switch's
                  // checkbox is visually hidden behind its track).
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden>{method.isActive ? d.methodOn : t.off}</span>
                    <Switch
                      name={field("isActive")}
                      checked={method.isActive}
                      aria-label={format(d.offer, { method: methodName })}
                      onChange={(event) => update(code, { isActive: event.target.checked })}
                    />
                  </label>
                }
              />

              <div
                className={cn("grid gap-4 transition-opacity", !method.isActive && "opacity-60")}
              >
                <div role="radiogroup" aria-label={d.rateType} className="grid gap-2">
                  <span className="text-sm font-medium">{d.rateType}</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {SHIPPING_RATE_TYPES.map((type) => (
                      <label
                        key={type}
                        className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm has-checked:border-foreground"
                      >
                        <input
                          type="radio"
                          name={field("rateType")}
                          value={type}
                          checked={method.rateType === type}
                          onChange={() => changeRateType(code, type)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="font-medium">{t.rateTypes[type]}</span>
                          <span className="text-xs text-muted-foreground">
                            {t.rateTypeHints[type]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {errorText(code, "rateType") && (
                    <p className="text-sm text-error">{errorText(code, "rateType")}</p>
                  )}
                </div>

                {method.rateType === "WEIGHT_BASED" && method.isActive && unweighedProducts > 0 && (
                  <Alert tone="warning">{format(d.unweighed, { count: unweighedProducts })}</Alert>
                )}

                {isTiered(method.rateType) ? (
                  <BandsEditor
                    code={code}
                    type={method.rateType}
                    bands={method.bands}
                    currency={currency}
                    errorOf={errorOf}
                    onChange={(bands) => update(code, { bands })}
                  />
                ) : (
                  <Field
                    id={`${id}-${code}-amount`}
                    label={format(d.amount, { currency: currency.code })}
                    hint={d.amountHint}
                    error={errorText(code, "amount")}
                    className="sm:max-w-[calc(50%-0.5rem)]"
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name={field("amount")}
                        value={method.amount}
                        onChange={(event) => update(code, { amount: event.target.value })}
                        inputMode="decimal"
                        dir="ltr"
                        autoComplete="off"
                        placeholder={minorToDecimal(0, currency.decimals)}
                      />
                    )}
                  </Field>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`${id}-${code}-threshold`}
                    label={format(d.threshold, { currency: currency.code })}
                    hint={d.thresholdHint}
                    optional={messages.catalogue.common.optional}
                    error={errorText(code, "freeShippingThreshold")}
                    className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]"
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name={field("freeShippingThreshold")}
                        value={method.freeShippingThreshold}
                        onChange={(event) =>
                          update(code, { freeShippingThreshold: event.target.value })
                        }
                        inputMode="decimal"
                        dir="ltr"
                        autoComplete="off"
                      />
                    )}
                  </Field>
                  <Field
                    id={`${id}-${code}-min`}
                    label={d.minDays}
                    hint={d.daysHint}
                    error={errorText(code, "minDays")}
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name={field("minDays")}
                        value={method.minDays}
                        onChange={(event) => update(code, { minDays: event.target.value })}
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                      />
                    )}
                  </Field>
                  <Field
                    id={`${id}-${code}-max`}
                    label={d.maxDays}
                    error={errorText(code, "maxDays")}
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name={field("maxDays")}
                        value={method.maxDays}
                        onChange={(event) => update(code, { maxDays: event.target.value })}
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                      />
                    )}
                  </Field>
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>

      <aside className="grid gap-4 lg:sticky lg:top-20">
        <section className="rounded-2xl border bg-card p-4 sm:p-5" aria-live="polite">
          <h2 className="caps mb-3 flex items-center gap-2 text-xs font-medium">
            <PackageCheck aria-hidden className="size-4" />
            {d.previewTitle}
          </h2>
          {deliverable ? (
            <ul className="grid gap-2">
              {config.methods.map(({ code }) => (
                <PreviewRow
                  key={code}
                  name={t.methods[code]}
                  method={methods[code]}
                  currency={currency}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {format(d.previewUnavailable, { country: countryName })}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {format(d.chargedIn, { currency: currency.code })}
          </p>
        </section>

        <div className="grid gap-2">
          <Button type="submit" size="lg" disabled={pending || !dirty} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
            {pending ? messages.catalogue.common.saving : d.save}
          </Button>
          {dirty && !pending && (
            <p className="text-center text-xs text-muted-foreground">
              {messages.catalogue.common.unsaved}
            </p>
          )}
        </div>
      </aside>
    </form>
  );
}

/** A stored bound for an input: kg for weight, the currency's decimals for order value. */
function boundInput(value: number, type: TieredRateType, decimals: number): string {
  return type === "WEIGHT_BASED" ? gramsToKg(value) : minorToDecimal(value, decimals);
}

function toState(method: ShippingMethodConfig, decimals: number): MethodState {
  const tiered = isTiered(method.rateType) ? method.rateType : null;
  return {
    isActive: method.isActive,
    rateType: method.rateType,
    amount: minorToDecimal(method.amount, decimals),
    bands: tiered
      ? method.bands.map((band) => ({
          key: crypto.randomUUID(),
          upTo: band.maxValue === null ? "" : boundInput(band.maxValue, tiered, decimals),
          amount: minorToDecimal(band.amount, decimals),
        }))
      : [],
    freeShippingThreshold:
      method.freeShippingThreshold === null
        ? ""
        : minorToDecimal(method.freeShippingThreshold, decimals),
    minDays: String(method.minDeliveryDays),
    maxDays: String(method.maxDeliveryDays),
  };
}

/**
 * Bands edited by their upper bound: "From" is the previous band's "Up to"
 * (0 for the first), and the last band has no upper bound. New bands are
 * added before the last one, so the open-ended band always stays last.
 */
function BandsEditor({
  code,
  type,
  bands,
  currency,
  errorOf,
  onChange,
}: {
  code: ShippingMethodCode;
  type: TieredRateType;
  bands: BandState[];
  currency: Currency;
  errorOf: (key: string) => string | undefined;
  onChange: (bands: BandState[]) => void;
}) {
  const { messages } = useI18n();
  const d = messages.shipping.detail;
  const unit = type === "WEIGHT_BASED" ? d.kg : currency.code;
  const zero = type === "WEIGHT_BASED" ? "0" : minorToDecimal(0, currency.decimals);
  const bandsError = errorOf(methodFieldName(code, "bands"));

  function change(key: string, patch: Partial<BandState>) {
    onChange(bands.map((band) => (band.key === key ? { ...band, ...patch } : band)));
  }

  function add() {
    const next = [...bands];
    next.splice(Math.max(0, next.length - 1), 0, {
      key: crypto.randomUUID(),
      upTo: "",
      amount: "",
    });
    onChange(next);
  }

  return (
    <div className="grid gap-2" data-field={methodFieldName(code, "bands")} tabIndex={-1}>
      <input
        type="hidden"
        name={methodFieldName(code, "bands")}
        value={JSON.stringify(
          bands.map((band, index) => ({
            upTo: index === bands.length - 1 ? "" : band.upTo,
            amount: band.amount,
          })),
        )}
        readOnly
      />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {type === "WEIGHT_BASED" ? d.weightBands : d.orderBands}
        </span>
        <span className="text-xs text-muted-foreground">
          {type === "WEIGHT_BASED" ? d.weightBandsHint : d.orderBandsHint}
        </span>
      </div>

      <ol className="grid gap-2">
        {bands.map((band, index) => {
          const last = index === bands.length - 1;
          const from = index === 0 ? zero : bands[index - 1].upTo || "…";
          const upToKey = bandFieldName(code, index, "upTo");
          const amountKey = bandFieldName(code, index, "amount");
          const upToError = errorOf(upToKey);
          const amountError = errorOf(amountKey);
          return (
            <li
              key={band.key}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <span className="col-span-3 grid gap-1 text-xs text-muted-foreground sm:col-span-1">
                <span>{d.bandFrom}</span>
                <span dir="ltr" className="justify-self-start text-sm text-foreground tabular-nums">
                  {from} {unit}
                </span>
              </span>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {format(d.bandUpTo, { unit })}
                {last ? (
                  <span className="flex h-11 items-center text-sm text-foreground">
                    {d.bandAndAbove}
                  </span>
                ) : (
                  <Input
                    name={upToKey}
                    value={band.upTo}
                    onChange={(event) => change(band.key, { upTo: event.target.value })}
                    inputMode="decimal"
                    dir="ltr"
                    autoComplete="off"
                    aria-invalid={upToError ? true : undefined}
                  />
                )}
                {upToError && <span className="text-error">{upToError}</span>}
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {format(d.bandRate, { currency: currency.code })}
                <Input
                  name={amountKey}
                  value={band.amount}
                  onChange={(event) => change(band.key, { amount: event.target.value })}
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  placeholder={minorToDecimal(0, currency.decimals)}
                  aria-invalid={amountError ? true : undefined}
                />
                {amountError && <span className="text-error">{amountError}</span>}
              </label>
              <Button
                variant="ghost"
                size="icon-sm"
                className="mt-5"
                disabled={bands.length === 1}
                aria-label={format(d.removeBand, { number: index + 1 })}
                title={format(d.removeBand, { number: index + 1 })}
                onClick={() => onChange(bands.filter((item) => item.key !== band.key))}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          );
        })}
      </ol>

      {bandsError && <p className="text-sm text-error">{bandsError}</p>}
      <div>
        <Button variant="outline" size="sm" disabled={bands.length >= MAX_BANDS} onClick={add}>
          <Plus aria-hidden />
          {d.addBand}
        </Button>
      </div>
    </div>
  );
}

/** One method as checkout would list it, from the values typed so far. */
function PreviewRow({
  name,
  method,
  currency,
}: {
  name: string;
  method: MethodState;
  currency: Currency;
}) {
  const { locale, messages } = useI18n();
  const t = messages.shipping;
  if (!method.isActive) {
    return (
      <li className="flex items-baseline justify-between gap-3 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
        <span>{name}</span>
        <span className="text-xs">{t.detail.previewNotOffered}</span>
      </li>
    );
  }
  const rate = (raw: string) => {
    const amount = parseMinor(raw, currency.decimals, { allowZero: true });
    return amount.ok ? rateLabel(t, amount.minor, currency, locale) : "—";
  };
  const threshold = method.freeShippingThreshold
    ? parseMinor(method.freeShippingThreshold, currency.decimals)
    : null;
  const min = parseDays(method.minDays);
  const max = parseDays(method.maxDays);
  const tiered = isTiered(method.rateType) ? method.rateType : null;
  const unit = tiered === "WEIGHT_BASED" ? t.detail.kg : currency.code;
  return (
    <li className="grid gap-0.5 rounded-xl border px-3 py-2.5 text-sm">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{name}</span>
        {!tiered && <span className="font-medium tabular-nums">{rate(method.amount)}</span>}
      </span>
      {tiered && (
        <ul className="grid gap-0.5 text-xs">
          {method.bands.map((band, index) => {
            const from = index === 0 ? "0" : method.bands[index - 1].upTo || "…";
            const last = index === method.bands.length - 1;
            return (
              <li key={band.key} className="flex justify-between gap-3 tabular-nums">
                <span className="text-muted-foreground" dir="ltr">
                  {last
                    ? format(t.detail.bandOver, { from, unit })
                    : `${from}–${band.upTo || "…"} ${unit}`}
                </span>
                <span>{rate(band.amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {min !== null && max !== null && min <= max && (
        <span className="text-xs text-muted-foreground">{deliveryDays(t, min, max)}</span>
      )}
      {threshold?.ok && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {format(t.freeOver, { amount: rateLabel(t, threshold.minor, currency, locale) })}
        </span>
      )}
    </li>
  );
}
