"use client";

import { cn } from "@/lib/utils/cn";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { AdjustStockDialog, type AdjustableItem } from "./adjust-stock-dialog";

/**
 * A product's stock pool (migration 042): its own stock, how much of it its
 * variants hold, and what's left to share out, with the pool's Adjust
 * button. Not for use inside another <form> (the dialog has its own).
 */
export function StockPoolSummary({
  item,
  className,
}: {
  /** The product (no variantId), with `allocated` set. */
  item: AdjustableItem & { allocated: number };
  className?: string;
}) {
  const { locale, messages } = useI18n();
  const t = messages.inventory.pool;
  const number = (value: number) => value.toLocaleString(locale);
  const unallocated = item.quantity - item.allocated;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border bg-card px-4 py-3",
        className,
      )}
    >
      <dl className="flex flex-1 flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="caps text-[0.625rem] text-muted-foreground">{t.total}</dt>
          <dd className="text-xl font-semibold tabular-nums">{number(item.quantity)}</dd>
        </div>
        <div>
          <dt className="caps text-[0.625rem] text-muted-foreground">{t.allocated}</dt>
          <dd className="text-xl font-semibold tabular-nums">{number(item.allocated)}</dd>
        </div>
        <div>
          <dt className="caps text-[0.625rem] text-muted-foreground">{t.unallocated}</dt>
          <dd
            className={cn(
              "text-xl font-semibold tabular-nums",
              unallocated > 0 ? "text-success" : "text-muted-foreground",
            )}
          >
            {number(unallocated)}
          </dd>
        </div>
      </dl>
      <p className="w-full text-xs text-muted-foreground sm:order-last">
        {format(t.explainer, { total: number(item.quantity) })}
      </p>
      <AdjustStockDialog item={item} />
    </div>
  );
}
