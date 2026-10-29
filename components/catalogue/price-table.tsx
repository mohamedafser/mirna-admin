"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import type { Currency, PriceError } from "@/lib/currency/money";
import {
  CURRENCY_PRICES_FIELD,
  parseSellingRow,
  sellingRowInput,
  type PriceInput,
  type PriceRowErrors,
} from "@/lib/currency/product-prices";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils/cn";

/**
 * One row per currency: optional regular price and the selling price, which
 * every active currency requires. The row in the product's own currency
 * (`base`) is posted as the product's price / compare-at fields (selling →
 * price, regular → compare-at), so saving and validating the product itself
 * is unchanged; the other rows are posted as JSON (`currencyPrices`) and
 * saved with set_product_prices(). Shows every active currency, plus inactive
 * ones that already have a price (optional: empty = not sold in it).
 */
export function PriceTable({
  currencies,
  base,
  initial,
  serverErrors,
  baseErrors,
  validate,
  disabled,
  onChange,
}: {
  currencies: Currency[];
  /** The product's own currency (products.currency_code). */
  base: string;
  /** Minor units by currency code. */
  initial: Record<string, { price: number | string; salePrice: number | string | null }>;
  serverErrors?: PriceRowErrors;
  /** Error text for the base row from the product's own price validation. */
  baseErrors?: { price?: string; salePrice?: string };
  /** Show "required" errors on rows not edited yet (after a save attempt). */
  validate: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue.products.prices;
  const shown = currencies
    .filter((currency) => currency.isActive || currency.code === base || initial[currency.code])
    .sort((a, b) => Number(b.code === base) - Number(a.code === base));

  const [values, setValues] = useState<Record<string, PriceInput>>(() =>
    Object.fromEntries(
      shown.map((currency) => {
        const saved = initial[currency.code];
        return [
          currency.code,
          { currency: currency.code, ...sellingRowInput(saved, currency.decimals) },
        ];
      }),
    ),
  );
  // Fields edited since the last server result: their server error is stale.
  const [edited, setEdited] = useState<Set<string>>(() => new Set());

  const baseRow = values[base] ?? { currency: base, price: "", salePrice: "" };
  const others = shown.filter((currency) => currency.code !== base);

  function update(code: string, field: "price" | "salePrice", value: string) {
    setValues((current) => ({ ...current, [code]: { ...current[code], [field]: value } }));
    setEdited((current) => new Set(current).add(code));
    onChange();
  }

  const errorText = (error?: PriceError) => error && messages.catalogue.products.priceErrors[error];

  return (
    <div className="grid gap-3">
      {/* The base row, as the product's own price fields (see above). */}
      <input type="hidden" name="currencyCode" value={base} readOnly />
      <input type="hidden" name="price" value={baseRow.salePrice} readOnly />
      <input type="hidden" name="compareAtPrice" value={baseRow.price} readOnly />
      <input
        type="hidden"
        name={CURRENCY_PRICES_FIELD}
        value={JSON.stringify(others.map((currency) => values[currency.code]))}
        readOnly
      />

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <caption className="sr-only">{t.title}</caption>
          <thead className="caps border-b bg-muted/40 text-[0.625rem] text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">
                {t.currency}
              </th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">
                {t.price}
              </th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">
                {t.salePrice}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((currency) => {
              const row = values[currency.code];
              const isBase = currency.code === base;
              const live = parseSellingRow(
                row.price,
                row.salePrice,
                currency.decimals,
                isBase || currency.isActive,
              );
              const showLive = validate || edited.has(currency.code);
              const errors = {
                ...(edited.has(currency.code) ? {} : serverErrors?.[currency.code]),
                ...(live.ok || !showLive ? {} : live.errors),
              };
              const priceError =
                errorText(errors.price) ?? (isBase ? baseErrors?.price : undefined);
              const saleError =
                errorText(errors.salePrice) ?? (isBase ? baseErrors?.salePrice : undefined);
              const placeholder =
                currency.decimals > 0 ? `0.${"0".repeat(currency.decimals)}` : "0";
              const inputId = (field: string) => `price-${currency.code}-${field}`;
              return (
                <tr key={currency.code} className="align-top">
                  <th scope="row" className="px-3 py-2.5 text-start font-normal">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium" dir="ltr">
                        {currency.code}
                      </span>
                      <span className="text-xs text-muted-foreground">{currency.symbol}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {isBase && <Badge tone="primary">{t.base}</Badge>}
                      {!currency.isActive && <Badge>{t.inactive}</Badge>}
                    </span>
                  </th>
                  {(["price", "salePrice"] as const).map((field) => {
                    const error = field === "price" ? priceError : saleError;
                    return (
                      <td key={field} className="px-3 py-2">
                        <label htmlFor={inputId(field)} className="sr-only">
                          {`${field === "price" ? t.price : t.salePrice} (${currency.code})`}
                        </label>
                        <Input
                          id={inputId(field)}
                          data-price-currency={currency.code}
                          inputMode="decimal"
                          dir="ltr"
                          autoComplete="off"
                          disabled={disabled}
                          required={field === "salePrice" && (isBase || currency.isActive)}
                          placeholder={field === "price" ? t.optional : placeholder}
                          value={row[field]}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${inputId(field)}-error` : undefined}
                          onChange={(event) => update(currency.code, field, event.target.value)}
                          className={cn("h-10", error && "border-error")}
                        />
                        {error && (
                          <p id={`${inputId(field)}-error`} className="mt-1 text-xs text-error">
                            {error}
                          </p>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {format(t.baseHint, { code: base })} {format(t.hint, { base })}
      </p>
    </div>
  );
}
