"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { formatMinor, type Currency } from "@/lib/currency/money";
import type { ProductListExtras } from "@/lib/catalogue/queries";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * A product's prices across currencies for the product list: its price in
 * its own currency (as before), a "+N" chip for its other currencies, and a
 * warning chip when an active currency has no price (it isn't sold there).
 * Hovering / focusing the chips lists every price (a variant's own price
 * counts as "has a price"; a "from" price shows the lowest).
 */
export function CurrencyPriceSummary({
  base,
  prices,
  currencies,
  align = "end",
}: {
  /** The product's own-currency price, already formatted (with any "was" price). */
  base: React.ReactNode;
  prices: ProductListExtras["prices"];
  /** Active currencies (null before migration 031: just the base price). */
  currencies: Currency[] | null;
  align?: "start" | "end";
}) {
  const { locale, messages } = useI18n();
  const t = messages.catalogue.products.list;
  const [open, setOpen] = useState(false);
  if (!currencies) {
    return <span className={cn("block", align === "end" ? "text-end" : "text-start")}>{base}</span>;
  }

  const lines = currencies.map((currency) => {
    const rows = prices.filter((row) => row.currency === currency.code);
    if (rows.length === 0) return { currency, text: null };
    const own = rows.find((row) => !row.variantId);
    const pick = own ?? rows.reduce((min, row) => (pay(row) < pay(min) ? row : min));
    const money = formatMinor(pay(pick), currency, locale);
    return {
      currency,
      text: own ? money : format(t.fromPrice, { price: money }),
    };
  });
  const priced = lines.filter((line) => line.text);
  const missing = lines.filter((line) => !line.text);

  return (
    <span
      className={cn(
        // Block-level (not inline), so table cells line it up with their
        // neighbours instead of on the text baseline.
        "relative flex w-fit flex-col gap-1",
        align === "end" ? "ms-auto items-end text-end" : "me-auto items-start text-start",
      )}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {base}
      <span
        className={cn(
          "flex flex-wrap items-center gap-1",
          align === "end" ? "justify-end" : "justify-start",
        )}
      >
        {priced.length > 1 && (
          <button
            type="button"
            className="rounded-full bg-brand-soft px-2 py-0.5 text-[0.6875rem] font-medium text-brand-soft-foreground tabular-nums"
            aria-label={format(t.currencyCount, { count: priced.length })}
          >
            {format(t.moreCurrencies, { count: priced.length - 1 })}
          </button>
        )}
        {missing.length > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[0.6875rem] font-medium text-warning"
            aria-label={format(t.missingCurrencies, {
              codes: missing.map((line) => line.currency.code).join(", "),
            })}
          >
            <TriangleAlert aria-hidden className="size-3" />
            {format(t.missingCount, { count: missing.length })}
          </button>
        )}
      </span>
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute top-full z-30 mt-1.5 grid w-60 gap-1 rounded-xl border bg-popover p-3 text-start text-xs text-popover-foreground shadow-elevated",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          <span className="caps mb-1 text-[0.625rem] text-muted-foreground">{t.pricesTitle}</span>
          {lines.map((line) => (
            <span key={line.currency.code} className="flex justify-between gap-3">
              <span className="font-medium" dir="ltr">
                {line.currency.code}
              </span>
              {line.text ? (
                <span className="tabular-nums">{line.text}</span>
              ) : (
                <span className="text-warning">{t.notSold}</span>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

const pay = (row: { price: number; salePrice: number | null }) => row.salePrice ?? row.price;
