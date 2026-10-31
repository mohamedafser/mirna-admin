"use client";

import { Globe, LoaderCircle, RotateCw, Save, ShieldCheck } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import {
  registerPaymentDomain,
  savePaymentSettings,
  validatePaymentDomain,
  verifyStripeAccount,
  type PaymentActionResult,
  type PaymentSettingsResult,
} from "@/lib/payments/actions";
import type { PaymentDomain, PaymentSettings } from "@/lib/payments/queries";
import { stripeDecimals } from "@/lib/payments/rules";
import { cn } from "@/lib/utils/cn";

function useActionResult() {
  const { messages } = useI18n();
  const toast = useToast();
  const t = messages.orders.payment.errors;
  return (result: PaymentActionResult, success: string) => {
    if (result.ok) toast.success(success);
    else toast.error(format(t[result.error], { detail: result.detail ?? "" }));
  };
}

const failed = (): PaymentActionResult => ({ ok: false, error: "unexpected" });

/** "Check Stripe account": reads the account and its supported currencies from Stripe. */
export function VerifyAccountButton({ disabled }: { disabled?: boolean }) {
  const { messages } = useI18n();
  const report = useActionResult();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () =>
          report(await verifyStripeAccount().catch(failed), messages.payments.connection.verified),
        )
      }
    >
      {pending ? (
        <LoaderCircle aria-hidden className="animate-spin" />
      ) : (
        <ShieldCheck aria-hidden />
      )}
      {messages.payments.connection.verify}
    </Button>
  );
}

/**
 * Stripe on/off, the currencies customers may pay in and the payment window.
 * Each store currency is listed; those Stripe doesn't support for this
 * account, or whose decimals don't match Stripe's, can't be chosen. The
 * server applies the same rules (and the database constraint keeps enabled
 * currencies within what Stripe supports). Keyed by the settings' version
 * on the page, so a save starts again from the stored values.
 */
export function PaymentSettingsForm({
  settings,
  currencies,
}: {
  settings: PaymentSettings;
  currencies: { code: string; decimals: number; isActive: boolean }[];
}) {
  const { messages } = useI18n();
  const t = messages.payments.settings;
  const toast = useToast();
  const id = useId();
  const [state, setState] = useState<PaymentSettingsResult>({
    status: "idle",
    fieldErrors: {},
    at: 0,
  });
  const [enabled, setEnabled] = useState(settings.stripe_enabled);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await savePaymentSettings(state, data).catch((): PaymentSettingsResult => ({
        status: "error",
        error: "unexpected",
        fieldErrors: {},
        at: Date.now(),
      }));
      setState(result);
      if (result.status === "success") toast.success(t.saved);
      else if (result.error) {
        toast.error(format(messages.orders.payment.errors[result.error], { detail: "" }));
      }
    });
  }

  const errorText = (key: keyof typeof state.fieldErrors) => {
    const error = state.fieldErrors[key];
    return error ? format(t.errors[error], { codes: (state.codes ?? []).join(", ") }) : undefined;
  };
  const verified = settings.stripe_verified_at !== null;
  const supported = new Set(settings.stripe_supported_currencies);
  const threeDecimal = currencies.some((c) => c.decimals === 3 && supported.has(c.code));

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <input type="hidden" name="updatedAt" value={settings.updated_at} />

      <div>
        {/* The whole row is the label: the Switch's checkbox is visually hidden,
            so clicks on its track reach it only through a label. */}
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-3.5 py-3 text-sm transition-colors hover:bg-accent/40 has-disabled:cursor-not-allowed">
          <span className="min-w-0">
            <span className="block font-medium">{t.enable}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t.enableHint}</span>
          </span>
          <Switch
            name="stripeEnabled"
            checked={enabled}
            disabled={pending}
            aria-invalid={errorText("enable") ? true : undefined}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </label>
        {errorText("enable") && <p className="mt-1.5 text-sm text-error">{errorText("enable")}</p>}
      </div>

      <fieldset className="grid gap-2" aria-describedby={`${id}-currencies-hint`}>
        <legend className="text-sm font-medium">{t.currencies}</legend>
        <p id={`${id}-currencies-hint`} className="text-xs text-muted-foreground">
          {verified ? t.currenciesHint : t.verifyFirst}
        </p>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {currencies.map((currency) => {
            const stripeDigits = stripeDecimals(currency.code);
            const problem = !supported.has(currency.code)
              ? t.notSupported
              : !currency.isActive
                ? t.inactive
                : stripeDigits !== currency.decimals
                  ? format(t.decimalsMismatch, { store: currency.decimals, stripe: stripeDigits })
                  : null;
            const checked = settings.enabled_currencies.includes(currency.code);
            return (
              <li key={currency.code}>
                <label
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm",
                    problem && !checked ? "opacity-60" : "cursor-pointer hover:border-input",
                  )}
                >
                  <input
                    type="checkbox"
                    name="currencies"
                    value={currency.code}
                    defaultChecked={checked}
                    disabled={pending || (problem !== null && !checked)}
                    className="size-4 accent-foreground"
                  />
                  <span className="font-medium" dir="ltr">
                    {currency.code}
                  </span>
                  {problem && (
                    <span className="ms-auto text-xs text-muted-foreground">{problem}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        {errorText("currencies") && <p className="text-sm text-error">{errorText("currencies")}</p>}
        {threeDecimal && <p className="text-xs text-muted-foreground">{t.threeDecimalNote}</p>}
      </fieldset>

      <Field
        id={`${id}-window`}
        label={t.window}
        hint={t.windowHint}
        error={errorText("window")}
        className="max-w-xs"
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="paymentWindow"
            inputMode="numeric"
            dir="ltr"
            defaultValue={String(settings.payment_window_minutes)}
            disabled={pending}
          />
        )}
      </Field>

      <div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          {t.save}
        </Button>
      </div>
    </form>
  );
}

/**
 * Apple Pay through the Payment Element needs every storefront domain
 * registered as a Stripe payment method domain. Lists them with their Apple
 * Pay status, and registers / re-checks a domain.
 */
export function PaymentDomains({
  domains,
  suggested,
}: {
  domains: PaymentDomain[];
  suggested: string | null;
}) {
  const { messages } = useI18n();
  const t = messages.payments.applePay;
  const report = useActionResult();
  const id = useId();
  const [domain, setDomain] = useState(
    suggested && !domains.some((d) => d.domain === suggested) ? suggested : "",
  );
  const [pending, startTransition] = useTransition();
  const [checking, setChecking] = useState<string | null>(null);

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !domain.trim()) return;
    startTransition(async () => {
      const result = await registerPaymentDomain(domain).catch(failed);
      report(result, t.registered);
      if (result.ok) setDomain("");
    });
  }

  function validate(domainId: string) {
    setChecking(domainId);
    startTransition(async () => {
      report(await validatePaymentDomain(domainId).catch(failed), t.validated);
      setChecking(null);
    });
  }

  return (
    <div className="grid gap-4">
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {domains.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
              <Globe aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="ltr">
                {item.domain}
              </span>
              <Badge
                tone={
                  !item.enabled ? "neutral" : item.applePay === "active" ? "success" : "warning"
                }
              >
                {!item.enabled ? t.disabled : item.applePay === "active" ? t.active : t.inactive}
              </Badge>
              {item.enabled && item.applePay !== "active" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-busy={checking === item.id}
                  onClick={() => validate(item.id)}
                >
                  {checking === item.id ? (
                    <LoaderCircle aria-hidden className="animate-spin" />
                  ) : (
                    <RotateCw aria-hidden />
                  )}
                  {t.validate}
                </Button>
              )}
              {item.applePayError && (
                <p className="w-full text-xs text-error" dir="ltr">
                  {item.applePayError}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={register} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field id={`${id}-domain`} label={t.domain} className="flex-1">
          {(a11y) => (
            <Input
              {...a11y}
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              placeholder="shop.example.com"
              value={domain}
              disabled={pending}
              onChange={(event) => setDomain(event.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="outline"
          className="h-11"
          disabled={pending || !domain.trim()}
        >
          {pending && !checking && <LoaderCircle aria-hidden className="animate-spin" />}
          {t.register}
        </Button>
      </form>
      <Alert tone="warning">{t.requirements}</Alert>
    </div>
  );
}
