"use client";

import { Divide, LoaderCircle, Minus, Plus } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { controlClassName } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { adjustStockBatch } from "@/lib/inventory/actions";
import type { StockAllocation } from "@/lib/inventory/queries";
import { parseWholeNumber } from "@/lib/inventory/rules";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * Shown after a product with variants is saved while part of its stock pool
 * (migration 042) isn't held by any variant: give units to variants, at most
 * what's unallocated (live counter; + stops at 0 left), or skip. Saved in one
 * transaction (adjust_stock_batch), recorded per variant in stock history.
 * Closing in any way calls `onClose`, which continues (e.g. to the list).
 *
 * Renders its own <form>: place it OUTSIDE any other form.
 */
export function ShareStockDialog({
  allocation,
  onClose,
}: {
  /** null: closed. */
  allocation: StockAllocation | null;
  onClose: () => void;
}) {
  const { messages } = useI18n();
  const t = messages.inventory.share;
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={allocation !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.title}
      description={allocation ? format(t.description, { name: allocation.name }) : undefined}
      dismissible={!pending}
      className="sm:max-w-xl"
    >
      {allocation && (
        <ShareForm
          key={allocation.productId}
          allocation={allocation}
          onPending={setPending}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ShareForm({
  allocation,
  onPending,
  onClose,
}: {
  allocation: StockAllocation;
  onPending: (pending: boolean) => void;
  onClose: () => void;
}) {
  const { locale, messages } = useI18n();
  const t = messages.inventory.share;
  const toast = useToast();
  const id = useId();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const number = (value: number) => value.toLocaleString(locale);

  const given = (variantId: string) => parseWholeNumber(amounts[variantId] ?? "") ?? 0;
  const invalid = allocation.variants.some(
    (variant) =>
      (amounts[variant.variantId] ?? "").trim() !== "" &&
      parseWholeNumber(amounts[variant.variantId]) === null,
  );
  const total = allocation.variants.reduce((sum, variant) => sum + given(variant.variantId), 0);
  const remaining = allocation.unallocated - total;

  function set(variantId: string, value: string) {
    setAmounts((current) => ({ ...current, [variantId]: value }));
    setError(null);
  }

  function step(variantId: string, delta: number) {
    const next = Math.max(0, given(variantId) + delta);
    set(variantId, next === 0 ? "" : String(next));
  }

  /** The unallocated units split across active variants (any remainder to the first). */
  function splitEvenly() {
    const active = allocation.variants.filter((variant) => variant.isActive);
    const targets = active.length > 0 ? active : allocation.variants;
    const each = Math.floor(allocation.unallocated / targets.length);
    let extra = allocation.unallocated - each * targets.length;
    const next: Record<string, string> = {};
    for (const variant of targets) {
      const value = each + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      if (value > 0) next[variant.variantId] = String(value);
    }
    setAmounts(next);
    setError(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (invalid) return setError(messages.inventory.errors.quantityInvalid);
    if (remaining < 0) return setError(messages.inventory.errors.exceedsPool);
    const lines = allocation.variants
      .filter((variant) => given(variant.variantId) > 0)
      .map((variant) => ({
        productId: allocation.productId,
        variantId: variant.variantId,
        quantity: String(given(variant.variantId)),
        expected: variant.quantity,
      }));
    if (lines.length === 0) return setError(t.nothingEntered);

    onPending(true);
    startTransition(async () => {
      const result = await adjustStockBatch({
        mode: "receive",
        reason: "manual_correction",
        notes: t.note,
        lines,
      });
      onPending(false);
      if (result.ok) {
        toast.success(format(t.saved, { count: number(total) }));
        onClose();
        return;
      }
      // A line's own error (e.g. the pool changed meanwhile), else the general one.
      const lineError = result.lineErrors ? Object.values(result.lineErrors)[0] : undefined;
      const errors = messages.inventory.errors;
      setError(
        lineError && lineError in errors
          ? format(errors[lineError as keyof typeof errors], { reserved: "0" })
          : result.error && result.error in errors
            ? errors[result.error as keyof typeof errors]
            : errors.unexpected,
      );
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <div
        aria-live="polite"
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-sm",
          remaining < 0 ? "bg-error/8 text-error" : "bg-muted/50",
        )}
      >
        <span>
          {format(t.remaining, {
            remaining: number(Math.max(remaining, 0)),
            total: number(allocation.unallocated),
          })}
          {remaining < 0 && ` · ${format(t.over, { count: number(-remaining) })}`}
        </span>
        <Button variant="outline" size="sm" disabled={pending} onClick={splitEvenly}>
          <Divide aria-hidden />
          {t.splitEvenly}
        </Button>
      </div>

      <ul className="grid max-h-[50dvh] gap-2 overflow-y-auto">
        {allocation.variants.map((variant) => {
          const inputId = `${id}-${variant.variantId}`;
          const value = given(variant.variantId);
          return (
            <li
              key={variant.variantId}
              className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5"
            >
              <label htmlFor={inputId} className="grid min-w-0 flex-1 gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <bdi>{variant.label}</bdi>
                  {!variant.isActive && <Badge className="py-0">{t.inactive}</Badge>}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {format(t.current, { count: number(variant.quantity) })}
                  {value > 0 && ` → ${number(variant.quantity + value)}`}
                </span>
              </label>
              <div className="flex items-stretch gap-1.5" dir="ltr">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={format(t.less, { name: variant.label })}
                  disabled={pending || value <= 0}
                  onClick={() => step(variant.variantId, -1)}
                >
                  <Minus aria-hidden />
                </Button>
                <input
                  id={inputId}
                  value={amounts[variant.variantId] ?? ""}
                  onChange={(event) => set(variant.variantId, event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  disabled={pending}
                  className={cn(controlClassName, "h-8 w-16 text-center tabular-nums")}
                />
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={format(t.more, { name: variant.label })}
                  // Nothing left to give: + stops.
                  disabled={pending || remaining <= 0}
                  onClick={() => step(variant.variantId, 1)}
                >
                  <Plus aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && !pending && <Alert>{error}</Alert>}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={pending} onClick={onClose}>
          {t.skip}
        </Button>
        <Button
          type="submit"
          disabled={pending || total === 0 || remaining < 0 || invalid}
          aria-busy={pending}
        >
          {pending && <LoaderCircle aria-hidden className="animate-spin" />}
          {pending ? messages.catalogue.common.saving : format(t.save, { count: number(total) })}
        </Button>
      </div>
    </form>
  );
}
