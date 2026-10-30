"use client";

import {
  ArrowRight,
  LoaderCircle,
  Minus,
  PackagePlus,
  Plus,
  ScanBarcode,
  Search,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { useUnsavedChanges } from "@/components/catalogue/use-unsaved-changes";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { adjustStockBatch, findStockItems, type BatchResult } from "@/lib/inventory/actions";
import type { StockItem } from "@/lib/inventory/queries";
import {
  ADJUSTMENT_REASONS,
  BATCH_MODES,
  MAX_BATCH_LINES,
  NOTES_MAX_LENGTH,
  previewBatchLine,
  type AdjustmentFieldErrors,
  type BatchMode,
} from "@/lib/inventory/rules";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StockStatusBadge } from "./stock-status-badge";

interface Line {
  item: StockItem;
  quantity: string;
}

type LineError = NonNullable<Extract<BatchResult, { ok: false }>["lineErrors"]>[number];

const MODE_ICONS: Record<BatchMode, LucideIcon> = {
  receive: Plus,
  count: ScanBarcode,
  remove: Minus,
};

/**
 * Update many items at once: receive a delivery (+), record a stock count
 * (=) or remove goods (−). Items are found by name or SKU (or all low / out
 * of stock ones are added in one go); each line previews its new on-hand
 * quantity. One reason and note apply to every line, and the batch is saved
 * in one transaction (all lines or none), each line recorded in stock history.
 */
export function StockUpdateForm() {
  const { locale, messages } = useI18n();
  const t = messages.inventory.update;
  const ta = messages.inventory.adjust;
  const toast = useToast();
  const id = useId();
  const [mode, setMode] = useState<BatchMode>("receive");
  const [reason, setReason] = useState<string>(BATCH_MODES.receive.reason);
  const [reasonTouched, setReasonTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockItem[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [pending, startSave] = useTransition();
  const [lineErrors, setLineErrors] = useState<Record<number, LineError>>({});
  const [fieldErrors, setFieldErrors] = useState<AdjustmentFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  useUnsavedChanges(lines.length > 0);

  // Search as the admin types (debounced); the latest request wins.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const found = await findStockItems(q);
        if (seq === searchSeq.current) setResults(found);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const added = new Set(lines.map((line) => line.item.key));
  // Results show for a search of 2+ characters (shorter ones are cleared).
  const shown = query.trim().length >= 2 ? results : null;
  const number = (value: number) => value.toLocaleString(locale);

  function changeMode(next: BatchMode) {
    setMode(next);
    if (!reasonTouched) setReason(BATCH_MODES[next].reason);
    // A count starts from the current quantity; +/- start empty.
    setLines((current) =>
      current.map((line) => ({
        ...line,
        quantity: next === "count" ? String(line.item.quantity) : "",
      })),
    );
    setLineErrors({});
    setFormError(null);
  }

  function addItems(items: StockItem[]) {
    setLines((current) => {
      const keys = new Set(current.map((line) => line.item.key));
      const fresh = items
        .filter((item) => !keys.has(item.key))
        .map((item) => ({ item, quantity: mode === "count" ? String(item.quantity) : "" }));
      return [...current, ...fresh].slice(0, MAX_BATCH_LINES);
    });
    setFormError(null);
  }

  function addAttention() {
    startSearch(async () => {
      const found = await findStockItems("", true);
      if (found.length === 0) toast.success(t.nothingLow);
      else addItems(found);
    });
  }

  function updateLine(index: number, quantity: string) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, quantity } : line)));
    setLineErrors((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
    setLineErrors({});
  }

  // Stock-pool limits (migration 042). Several lines of one product share
  // its pool: the database re-checks the batch as a whole.
  const previews = lines.map((line) =>
    previewBatchLine(mode, line.quantity, {
      quantity: line.item.quantity,
      reserved: line.item.reserved,
      min: line.item.allocated,
      max:
        line.item.poolAvailable === undefined
          ? undefined
          : line.item.quantity + line.item.poolAvailable,
    }),
  );
  const changes = previews.filter((preview) => preview.ok === true).length;
  const unitChange = previews.reduce(
    (sum, preview) => sum + (preview.ok === true ? preview.change : 0),
    0,
  );

  const errors = messages.inventory.errors;
  const lineErrorText = (error: LineError | undefined, item: StockItem) =>
    error && format(errors[error], { reserved: number(item.reserved) });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // Client check first (instant feedback); the server and database re-check.
    const found: Record<number, LineError> = {};
    previews.forEach((preview, index) => {
      if (preview.ok === false) found[index] = preview.error;
    });
    const fields: AdjustmentFieldErrors = {};
    if (reason === "other" && !notes.trim()) fields.notes = "notesRequired";
    setLineErrors(found);
    setFieldErrors(fields);
    if (Object.keys(found).length > 0 || Object.keys(fields).length > 0) {
      setFormError(t.fixLines);
      return;
    }
    if (changes === 0) {
      setFormError(t.errors.nothingToChange);
      return;
    }
    setFormError(null);
    startSave(async () => {
      const result = await adjustStockBatch({
        mode,
        reason,
        notes,
        lines: lines.map((line) => ({
          productId: line.item.productId,
          variantId: line.item.variantId,
          quantity: line.quantity,
          expected: line.item.quantity,
        })),
      });
      if (result.ok) {
        toast.success(format(t.saved, { count: result.count }));
        setLines([]);
        setNotes("");
        setResults(null);
        setQuery("");
        return;
      }
      setLineErrors(result.lineErrors ?? {});
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(
        result.error
          ? result.error in t.errors
            ? t.errors[result.error as keyof typeof t.errors]
            : errors[result.error as keyof typeof errors]
          : t.fixLines,
      );
    });
  }

  const quantityLabel = t.quantityLabels[mode];

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="grid min-w-0 gap-4">
        {/* Mode */}
        <div role="radiogroup" aria-label={t.modeLabel} className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(BATCH_MODES) as BatchMode[]).map((value) => {
            const Icon = MODE_ICONS[value];
            return (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-card p-3.5 text-sm has-checked:border-foreground has-checked:ring-1 has-checked:ring-foreground"
              >
                <input
                  type="radio"
                  name="mode"
                  value={value}
                  checked={mode === value}
                  disabled={pending}
                  onChange={() => changeMode(value)}
                  className="sr-only"
                />
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-soft-foreground">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium">{t.modes[value]}</span>
                  <span className="text-xs text-muted-foreground">{t.modeHints[value]}</span>
                </span>
              </label>
            );
          })}
        </div>

        {/* Find items */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-search`} className="mb-2 block text-sm font-medium">
                {t.searchLabel}
              </label>
              <Input
                ref={searchRef}
                id={`${id}-search`}
                type="search"
                icon={Search}
                value={query}
                placeholder={t.searchPlaceholder}
                autoComplete="off"
                disabled={pending}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds the first match (scanner friendly).
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const match = shown?.find((item) => !added.has(item.key));
                    if (match) {
                      addItems([match]);
                      setQuery("");
                    }
                  }
                }}
                trailing={
                  searching ? (
                    <LoaderCircle aria-hidden className="me-2 size-4 animate-spin" />
                  ) : null
                }
              />
            </div>
            <Button variant="outline" disabled={pending || searching} onClick={addAttention}>
              <TriangleAlert aria-hidden />
              {t.addLow}
            </Button>
          </div>

          {shown !== null && (
            <div className="mt-3" aria-live="polite">
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noResults}</p>
              ) : (
                <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
                  {shown.map((item) => {
                    const isAdded = added.has(item.key);
                    return (
                      <li key={item.key} className="flex items-center gap-3 px-3 py-2">
                        <ItemName item={item} />
                        <span className="hidden text-xs text-muted-foreground tabular-nums sm:block">
                          {format(t.onHand, { count: number(item.quantity) })}
                        </span>
                        <Button
                          variant={isAdded ? "ghost" : "outline"}
                          size="sm"
                          disabled={isAdded || pending}
                          onClick={() => addItems([item])}
                        >
                          {isAdded ? t.added : t.add}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Lines */}
        <section aria-labelledby={`${id}-lines`} className="rounded-2xl border bg-card">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 id={`${id}-lines`} className="caps text-xs font-medium">
              {format(t.linesTitle, { count: lines.length })}
            </h2>
            {lines.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setLines([]);
                  setLineErrors({});
                }}
              >
                {t.clear}
              </Button>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <PackagePlus
                aria-hidden
                strokeWidth={1.25}
                className="size-9 text-muted-foreground"
              />
              <p className="text-sm font-medium">{t.emptyTitle}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{t.emptyBody}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => searchRef.current?.focus()}
              >
                <Search aria-hidden />
                {t.findItems}
              </Button>
            </div>
          ) : (
            <ol className="divide-y">
              {lines.map((line, index) => {
                const preview = previews[index];
                const error = lineErrorText(lineErrors[index], line.item);
                const inputId = `${id}-line-${index}`;
                return (
                  <li
                    key={line.item.key}
                    className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_auto] sm:items-center"
                  >
                    <div className="grid min-w-0 gap-1">
                      <ItemName item={line.item} />
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <StockStatusBadge
                          status={line.item.stockStatus}
                          label={messages.inventory.status[line.item.stockStatus]}
                        />
                        <span className="tabular-nums">
                          {format(t.onHand, { count: number(line.item.quantity) })}
                        </span>
                        {line.item.reserved > 0 && (
                          <span className="tabular-nums">
                            {format(t.reserved, { count: number(line.item.reserved) })}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="grid gap-1">
                      <label htmlFor={inputId} className="text-xs text-muted-foreground">
                        {quantityLabel}
                      </label>
                      <Input
                        id={inputId}
                        value={line.quantity}
                        onChange={(event) => updateLine(index, event.target.value)}
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                        disabled={pending}
                        className="h-9 text-end tabular-nums"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${inputId}-error` : undefined}
                      />
                    </div>
                    <div className="text-sm">
                      <span className="block text-xs text-muted-foreground">{t.newOnHand}</span>
                      {preview.ok === true ? (
                        <span className="flex items-center gap-1.5 tabular-nums">
                          <span className="text-muted-foreground">
                            {number(line.item.quantity)}
                          </span>
                          <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
                          <span className="font-semibold">{number(preview.newQuantity)}</span>
                          <span
                            className={cn(
                              "text-xs",
                              preview.change > 0 ? "text-success" : "text-error",
                            )}
                          >
                            ({preview.change > 0 ? "+" : "−"}
                            {number(Math.abs(preview.change))})
                          </span>
                        </span>
                      ) : preview.ok === "skip" ? (
                        <span className="text-muted-foreground">{t.noChange}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="justify-self-end"
                      disabled={pending}
                      aria-label={format(t.remove, { name: line.item.name })}
                      title={format(t.remove, { name: line.item.name })}
                      onClick={() => removeLine(index)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                    {error && (
                      <p id={`${inputId}-error`} className="text-sm text-error sm:col-span-4">
                        {error}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* Reason, note, summary and save */}
      <aside className="grid gap-4 lg:sticky lg:top-20">
        <section className="grid gap-4 rounded-2xl border bg-card p-4 sm:p-5">
          <Field id={`${id}-reason`} label={ta.reason} error={undefined}>
            {(a11y) => (
              <Combobox
                {...a11y}
                value={reason}
                disabled={pending}
                onChange={(value) => {
                  setReason(value);
                  setReasonTouched(true);
                  setFieldErrors({});
                }}
                options={ADJUSTMENT_REASONS.map((value) => ({
                  value,
                  label: ta.reasons[value],
                }))}
              />
            )}
          </Field>
          <Field
            id={`${id}-notes`}
            label={ta.notes}
            optional={reason === "other" ? undefined : messages.catalogue.common.optional}
            hint={t.notesHint}
            error={fieldErrors.notes ? errors[fieldErrors.notes] : undefined}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                rows={2}
                value={notes}
                maxLength={NOTES_MAX_LENGTH}
                disabled={pending}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setFieldErrors({});
                }}
              />
            )}
          </Field>

          <dl className="grid gap-1.5 border-t pt-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t.summaryItems}</dt>
              <dd className="tabular-nums">{number(changes)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t.summaryUnits}</dt>
              <dd
                className={cn(
                  "font-semibold tabular-nums",
                  unitChange > 0 && "text-success",
                  unitChange < 0 && "text-error",
                )}
              >
                {unitChange > 0 ? "+" : unitChange < 0 ? "−" : ""}
                {number(Math.abs(unitChange))}
              </dd>
            </div>
          </dl>
        </section>

        {formError && !pending && <Alert>{formError}</Alert>}

        <Button
          type="submit"
          size="lg"
          disabled={pending || lines.length === 0}
          aria-busy={pending}
        >
          {pending ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : (
            <PackagePlus aria-hidden />
          )}
          {pending ? messages.catalogue.common.saving : format(t.save, { count: changes })}
        </Button>
        <p className="text-xs text-muted-foreground">{t.atomicNote}</p>
      </aside>
    </form>
  );
}

function ItemName({ item }: { item: StockItem }) {
  const { messages } = useI18n();
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <CatalogueImage src={item.imageUrl} alt="" sizes="36px" className="size-9 rounded-md" />
      <span className="grid min-w-0 gap-0.5 text-sm">
        <span className="line-clamp-1 font-medium">
          <bdi>{item.name}</bdi>
          {item.label && (
            <span className="text-muted-foreground">
              {" · "}
              <bdi>{item.label}</bdi>
            </span>
          )}
          {item.variantCount > 0 && (
            <span className="text-muted-foreground">
              {" · "}
              {format(messages.inventory.pool.itemLabel, { count: item.variantCount })}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono" dir="ltr">
            {item.sku}
          </span>
          {!item.productActive && (
            <Badge className="py-0">{messages.inventory.productInactive}</Badge>
          )}
        </span>
      </span>
    </span>
  );
}
