"use client";

import { LoaderCircle, Star } from "lucide-react";
import { useTransition } from "react";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  setCurrencyActive,
  setDefaultCurrency,
  type CurrencyResult,
} from "@/lib/currencies/actions";
import type { Currency } from "@/lib/currency/money";
import { useI18n } from "@/lib/i18n/client";
import { CurrencyDialog } from "./currency-dialog";
import { format } from "@/lib/i18n/messages";

/**
 * Every currency with its shipping countries: enable / disable it, or make it
 * the default. The default is always active, so it can't be disabled.
 */
export function CurrencyList({
  currencies,
  countries,
}: {
  currencies: Currency[];
  countries: { countryCode: string; currencyCode: string }[];
}) {
  const { locale, messages } = useI18n();
  const t = messages.currencies;
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });

  function run(action: () => Promise<CurrencyResult>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(t.errors[result.error]);
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">{messages.nav.currencies}</caption>
        <thead className="caps border-b text-[0.625rem] text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 text-start font-medium">
              {t.columns.currency}
            </th>
            <th scope="col" className="hidden px-4 py-3 text-start font-medium md:table-cell">
              {t.columns.countries}
            </th>
            <th scope="col" className="px-4 py-3 text-start font-medium">
              {t.columns.status}
            </th>
            <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
              <span className="sr-only">{t.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {currencies.map((currency) => {
            const shipsTo = countries.filter((row) => row.currencyCode === currency.code);
            return (
              <tr key={currency.code} className="align-middle">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-xs font-semibold text-brand-soft-foreground">
                      {currency.symbol}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span dir="ltr">{currency.code}</span>
                        {currency.isDefault && (
                          <Badge tone="primary">
                            <Star aria-hidden />
                            {t.default}
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(t.decimals, { count: currency.decimals })}
                      </p>
                      {shipsTo.length === 0 && currency.isActive && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{t.switcherOnly}</p>
                      )}
                      {/* Phones: countries under the name. */}
                      <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                        {shipsTo.map((row) => regionNames.of(row.countryCode)).join(" · ")}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                  {shipsTo.length > 0
                    ? shipsTo.map((row) => regionNames.of(row.countryCode)).join(" · ")
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge
                    active={currency.isActive}
                    activeLabel={messages.catalogue.common.active}
                    inactiveLabel={messages.catalogue.common.inactive}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    <CurrencyDialog currency={currency} />
                    {!currency.isDefault && currency.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => setDefaultCurrency(currency.code),
                            format(t.defaultSet, { code: currency.code }),
                          )
                        }
                      >
                        {t.makeDefault}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending || currency.isDefault}
                      title={currency.isDefault ? t.defaultLocked : undefined}
                      aria-label={`${currency.isActive ? t.disable : t.enable}: ${currency.code}`}
                      onClick={() =>
                        run(
                          () => setCurrencyActive(currency.code, !currency.isActive),
                          format(currency.isActive ? t.disabled : t.enabled, {
                            code: currency.code,
                          }),
                        )
                      }
                    >
                      {pending && <LoaderCircle aria-hidden className="animate-spin" />}
                      {currency.isActive ? t.disable : t.enable}
                    </Button>
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
