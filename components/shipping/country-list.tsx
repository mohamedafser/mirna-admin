"use client";

import { CircleCheck, CircleSlash, LoaderCircle, Settings2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { setShippingCountryActive } from "@/lib/shipping/actions";
import {
  isDeliverable,
  type ShippingCountryConfig,
  type ShippingMethodConfig,
} from "@/lib/shipping/rules";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { countryLabel, deliveryDays, rateLabel } from "./format";

/**
 * Every delivery country with its currency, both methods (rate, estimate,
 * free-delivery threshold) and status. Enabling is immediate; disabling asks
 * first (it blocks checkout there). Rows open the country's details page.
 */
export function ShippingCountryList({
  countries,
  decimals,
}: {
  countries: ShippingCountryConfig[];
  /** Currency code → decimals (currencies.decimals). */
  decimals: Record<string, number>;
}) {
  const { locale, messages } = useI18n();
  const t = messages.shipping;
  const common = messages.catalogue.common;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">{messages.nav.shipping}</caption>
        <thead className="caps border-b text-[0.625rem] text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 text-start font-medium">
              {t.columns.country}
            </th>
            <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
              {t.columns.standard}
            </th>
            <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
              {t.columns.express}
            </th>
            <th scope="col" className="hidden px-4 py-3 text-start font-medium sm:table-cell">
              {t.columns.status}
            </th>
            <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
              <span className="sr-only">{t.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {countries.map((country) => {
            const name = countryLabel(country.countryCode, locale);
            const currency = {
              code: country.currencyCode,
              decimals: decimals[country.currencyCode] ?? 2,
            };
            const href = `/${locale}/admin/shipping/${country.countryCode}`;
            const blocked = country.isActive && !isDeliverable(country);
            return (
              <tr key={country.countryCode} className="align-middle">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      dir="ltr"
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-xs font-semibold text-brand-soft-foreground"
                    >
                      {country.countryCode}
                    </span>
                    <div className="min-w-0">
                      <Link href={href} className="font-medium hover:underline">
                        {name}
                      </Link>
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {country.currencyCode}
                      </p>
                      {/* Below lg: both methods under the name; below sm: the status too. */}
                      <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground lg:hidden">
                        {country.methods.map((method) => (
                          <span key={method.code}>
                            {t.methods[method.code]}:{" "}
                            <MethodSummary method={method} currency={currency} compact />
                          </span>
                        ))}
                      </div>
                      <div className="mt-1.5 sm:hidden">
                        <StatusBadge
                          active={country.isActive}
                          activeLabel={common.active}
                          inactiveLabel={common.inactive}
                        />
                      </div>
                      {blocked && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                          {t.blocked}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                {country.methods.map((method) => (
                  <td key={method.code} className="hidden px-4 py-3 lg:table-cell">
                    <MethodSummary method={method} currency={currency} />
                  </td>
                ))}
                <td className="hidden px-4 py-3 sm:table-cell">
                  <StatusBadge
                    active={country.isActive}
                    activeLabel={common.active}
                    inactiveLabel={common.inactive}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    <Link
                      href={href}
                      aria-label={format(t.configureNamed, { country: name })}
                      title={t.configure}
                      className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
                    >
                      <Settings2 aria-hidden />
                    </Link>
                    <CountryStatusToggle
                      countryCode={country.countryCode}
                      name={name}
                      active={country.isActive}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t.note}</p>
    </div>
  );
}

/** "AED 15.00 · 3–5 days · Free over AED 200.00", or "Off". */
function MethodSummary({
  method,
  currency,
  compact = false,
}: {
  method: ShippingMethodConfig;
  currency: { code: string; decimals: number };
  compact?: boolean;
}) {
  const { locale, messages } = useI18n();
  const t = messages.shipping;
  if (!method.isActive) return <span className="text-muted-foreground">{t.off}</span>;
  // Tiered: the type and its cheapest band ("Weight-based · from AED 10.00").
  const rate =
    method.rateType === "FLAT"
      ? rateLabel(t, method.amount, currency, locale)
      : `${t.rateTypes[method.rateType]} · ${format(t.fromAmount, {
          amount: rateLabel(
            t,
            Math.min(...method.bands.map((band) => band.amount), Number.MAX_SAFE_INTEGER),
            currency,
            locale,
          ),
        })}`;
  const days = deliveryDays(t, method.minDeliveryDays, method.maxDeliveryDays);
  const free =
    method.freeShippingThreshold !== null
      ? format(t.freeOver, {
          amount: rateLabel(t, method.freeShippingThreshold, currency, locale),
        })
      : null;
  if (compact) {
    return <span className="tabular-nums">{[rate, days, free].filter(Boolean).join(" · ")}</span>;
  }
  return (
    <div className="grid gap-0.5">
      <span className="font-medium tabular-nums">{rate}</span>
      <span className="text-xs text-muted-foreground">{days}</span>
      {free && <span className="text-xs text-muted-foreground tabular-nums">{free}</span>}
    </div>
  );
}

function CountryStatusToggle({
  countryCode,
  name,
  active,
}: {
  countryCode: string;
  name: string;
  active: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.shipping;
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(next: boolean) {
    startTransition(async () => {
      const result = await setShippingCountryActive(countryCode, next);
      if (result.ok) {
        toast.success(format(next ? t.enabled : t.disabled, { country: name }));
        setConfirming(false);
      } else {
        toast.error(t.errors[result.error]);
      }
    });
  }

  const label = active ? t.disable : t.enable;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        aria-label={`${label}: ${name}`}
        onClick={() => (active ? setConfirming(true) : apply(true))}
      >
        {pending && !confirming ? (
          <LoaderCircle aria-hidden className="animate-spin" />
        ) : active ? (
          <CircleSlash aria-hidden />
        ) : (
          <CircleCheck aria-hidden />
        )}
        <span aria-hidden className="hidden sm:inline">
          {label}
        </span>
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={format(t.disableTitle, { country: name })}
        description={t.disableBody}
        confirmLabel={t.disable}
        pending={pending}
        onConfirm={() => apply(false)}
      />
    </>
  );
}
