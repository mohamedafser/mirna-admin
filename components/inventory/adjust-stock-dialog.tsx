"use client";

import {
  ArrowRight,
  BellRing,
  ChevronDown,
  LoaderCircle,
  Minus,
  PencilLine,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { controlClassName, Field, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { adjustStock, type InventoryFormError } from "@/lib/inventory/actions";
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_TYPES,
  NOTES_MAX_LENGTH,
  QUANTITY_MAX,
  parseWholeNumber,
  previewAdjustment,
  stockStatus,
  validateAdjustment,
  type AdjustmentError,
  type AdjustmentFieldErrors,
  type AdjustmentType,
} from "@/lib/inventory/rules";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StockStatusBadge } from "./stock-status-badge";
import { ThresholdForm } from "./threshold-form";

export interface AdjustableItem {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  reserved: number;
  threshold: number;
}

const typeIcons = { increase: Plus, decrease: Minus, set: PencilLine } as const;

/** One-tap amounts for Increase / Decrease. */
const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

/** "Adjust" button + dialog: stock summary, adjustment form and threshold. */
export function AdjustStockDialog({
  item,
  compact = false,
}: {
  item: AdjustableItem;
  /** Icon-only trigger (tables, phone rows). */
  compact?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.inventory.adjust;
  const [open, setOpen] = useState(false);
  // Remount the form on every open so it starts from the latest stock values.
  const [session, setSession] = useState(0);

  return (
    <>
      <Button
        variant={compact ? "outline" : "primary"}
        size={compact ? "icon-sm" : "md"}
        aria-label={format(t.buttonNamed, { name: item.name })}
        title={compact ? t.button : undefined}
        onClick={() => {
          setSession((value) => value + 1);
          setOpen(true);
        }}
      >
        <SlidersHorizontal aria-hidden />
        {!compact && <span aria-hidden>{t.button}</span>}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t.title}
        description={
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <bdi className="truncate font-medium text-foreground">{item.name}</bdi>
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs" dir="ltr">
              {item.sku}
            </span>
          </span>
        }
      >
        <AdjustForm key={session} item={item} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function AdjustForm({ item, onDone }: { item: AdjustableItem; onDone: () => void }) {
  const { messages, locale } = useI18n();
  const t = messages.inventory;
  const toast = useToast();
  const [type, setType] = useState<AdjustmentType>("increase");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AdjustmentFieldErrors>({});
  const [formError, setFormError] = useState<InventoryFormError | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const current = { quantity: item.quantity, reserved: item.reserved };
  const amount = parseWholeNumber(quantity);
  const preview = amount === null ? null : previewAdjustment(type, amount, current);
  const next = preview?.ok ? preview.newQuantity : null;

  // Live feedback while typing; "no change" stays quiet until submit.
  const liveError: AdjustmentError | undefined =
    quantity.trim() === ""
      ? undefined
      : amount === null
        ? "quantityInvalid"
        : preview && !preview.ok && preview.error !== "noChange"
          ? preview.error
          : undefined;

  const number = (value: number) => value.toLocaleString(locale);
  const errorText = (code?: AdjustmentError) =>
    code && format(t.errors[code], { reserved: item.reserved });

  function changeType(option: AdjustmentType) {
    setType(option);
    setFieldErrors((errors) => ({ ...errors, quantity: undefined }));
    // "Set" starts from the current stock; amounts start empty.
    if (option === "set" && quantity.trim() === "") setQuantity(String(item.quantity));
    if (option !== "set" && type === "set") setQuantity("");
  }

  function step(delta: number) {
    const base = amount ?? 0;
    setQuantity(String(Math.min(QUANTITY_MAX, Math.max(0, base + delta))));
    setFieldErrors((errors) => ({ ...errors, quantity: undefined }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const errors = validateAdjustment(
      {
        type,
        quantity,
        reason,
        notes: String(data.get("notes") ?? ""),
      },
      current,
    );
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    startTransition(async () => {
      try {
        const result = await adjustStock(data);
        if (result.ok) {
          toast.success(format(t.adjust.success, { quantity: result.quantity }));
          onDone();
          return;
        }
        setFieldErrors(result.fieldErrors);
        setFormError(result.error ?? null);
      } catch {
        // The request never completed (offline / connection lost): nothing changed.
        setFormError("network");
      }
    });
  }

  const submitLabel =
    preview?.ok && amount !== null
      ? format(t.adjust.submitTyped[type], { count: number(amount) })
      : t.adjust.submit;

  const currentStatus = stockStatus(item.quantity, item.reserved, item.threshold);
  const nextStatus = next === null ? null : stockStatus(next, item.reserved, item.threshold);
  const change = preview?.ok ? preview.change : null;

  return (
    <div className="grid gap-5">
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <input type="hidden" name="productId" value={item.productId} readOnly />
        <input type="hidden" name="type" value={type} readOnly />
        <input type="hidden" name="expectedQuantity" value={item.quantity} readOnly />

        {formError && !pending && <Alert>{t.errors[formError]}</Alert>}

        {/* 1. What kind of change */}
        <fieldset disabled={pending}>
          <legend className="mb-2 text-sm font-medium">{t.adjust.type}</legend>
          <div className="grid grid-cols-3 gap-2">
            {ADJUSTMENT_TYPES.map((option) => {
              const Icon = typeIcons[option];
              const selected = type === option;
              return (
                <label
                  key={option}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-1.5 border px-2 py-3 font-display text-xs font-medium transition-colors",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    selected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:border-input hover:bg-accent hover:text-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-type`}
                    value={option}
                    checked={selected}
                    onChange={() => changeType(option)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-8 place-items-center",
                      selected ? "bg-background/15" : "bg-muted",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="text-center leading-tight">{t.adjust.types[option]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* 2. How much */}
        <Field
          id={`${id}-quantity`}
          label={t.adjust.quantity[type]}
          error={errorText(fieldErrors.quantity ?? liveError)}
          hint={
            item.reserved > 0
              ? format(t.adjust.reservedHint, { reserved: item.reserved })
              : undefined
          }
        >
          {(a11y) => (
            <div className="grid gap-2">
              <div className="flex items-stretch gap-2" dir="ltr">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label={t.adjust.decreaseOne}
                  disabled={pending || (amount ?? 0) <= 0}
                  onClick={() => step(-1)}
                >
                  <Minus aria-hidden />
                </Button>
                <input
                  {...a11y}
                  name="quantity"
                  value={quantity}
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={pending}
                  placeholder="0"
                  onChange={(event) => setQuantity(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      step(1);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      step(-1);
                    }
                  }}
                  className={cn(
                    controlClassName,
                    "h-11 min-w-0 flex-1 text-center font-display text-lg font-medium tabular-nums sm:text-lg",
                  )}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label={t.adjust.increaseOne}
                  disabled={pending}
                  onClick={() => step(1)}
                >
                  <Plus aria-hidden />
                </Button>
              </div>
              {type !== "set" && (
                <div role="group" aria-label={t.adjust.quick} className="flex flex-wrap gap-1.5">
                  {QUICK_AMOUNTS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={pending}
                      aria-pressed={amount === value}
                      onClick={() => {
                        setQuantity(String(value));
                        setFieldErrors((errors) => ({ ...errors, quantity: undefined }));
                      }}
                      className={cn(
                        "h-8 min-w-11 border px-3 text-sm font-medium tabular-nums transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60",
                        amount === value
                          ? "border-foreground bg-foreground text-background"
                          : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {number(value)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>

        {/* Live before → after */}
        <div
          aria-live="polite"
          className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 rounded-2xl border bg-muted/30 p-3"
        >
          <StockColumn
            heading={t.adjust.current}
            stock={item.quantity}
            available={item.quantity - item.reserved}
            reserved={item.reserved}
            status={currentStatus}
            labels={t}
            format={number}
          />
          <div className="flex flex-col items-center justify-center gap-1">
            <ArrowRight aria-hidden className="size-5 text-muted-foreground rtl:-scale-x-100" />
            {change !== null && (
              <span
                dir="ltr"
                className={cn(
                  "border px-2 py-0.5 text-xs font-semibold tabular-nums",
                  change > 0 ? "border-success/40 text-success" : "border-error/40 text-error",
                )}
              >
                {change > 0 ? "+" : "−"}
                {number(Math.abs(change))}
              </span>
            )}
          </div>
          <StockColumn
            heading={t.adjust.after}
            stock={next}
            available={next === null ? null : next - item.reserved}
            reserved={item.reserved}
            status={nextStatus}
            labels={t}
            format={number}
            highlight
          />
        </div>

        {/* 3. Why */}
        <fieldset
          disabled={pending}
          aria-describedby={fieldErrors.reason ? `${id}-reason-error` : undefined}
        >
          <legend className="mb-2 text-sm font-medium">{t.adjust.reason}</legend>
          <div className="flex flex-wrap gap-1.5">
            {ADJUSTMENT_REASONS.map((value) => (
              <label
                key={value}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center border px-3.5 text-sm transition-colors",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                  reason === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-foreground hover:bg-accent",
                  fieldErrors.reason && reason === "" && "border-error/60",
                )}
              >
                <input
                  type="radio"
                  name="reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => {
                    setReason(value);
                    setFieldErrors((errors) => ({
                      ...errors,
                      reason: undefined,
                      notes: value === "other" ? errors.notes : undefined,
                    }));
                  }}
                  className="sr-only"
                />
                {t.adjust.reasons[value]}
              </label>
            ))}
          </div>
          {fieldErrors.reason && (
            <p id={`${id}-reason-error`} className="mt-2 text-sm text-error">
              {errorText(fieldErrors.reason)}
            </p>
          )}
        </fieldset>

        <Field
          id={`${id}-notes`}
          label={t.adjust.notes}
          optional={reason === "other" ? undefined : messages.catalogue.common.optional}
          hint={reason === "other" ? undefined : t.adjust.notesHint}
          error={errorText(fieldErrors.notes)}
        >
          {(a11y) => (
            <Textarea
              {...a11y}
              name="notes"
              rows={2}
              maxLength={NOTES_MAX_LENGTH}
              disabled={pending}
              className="min-h-16"
            />
          )}
        </Field>

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" disabled={pending} onClick={onDone}>
            {messages.catalogue.common.cancel}
          </Button>
          <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
            {pending && <LoaderCircle aria-hidden className="animate-spin" />}
            {pending ? t.adjust.saving : submitLabel}
          </Button>
        </div>
      </form>

      {/* Secondary setting, tucked away so it doesn't compete with the main form. */}
      <details className="group rounded-xl border bg-muted/20">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 py-3 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden">
          <BellRing aria-hidden className="size-4 text-muted-foreground" />
          <span className="flex-1">
            {item.threshold > 0
              ? format(t.adjust.thresholdSummary, { threshold: number(item.threshold) })
              : t.adjust.thresholdOff}
          </span>
          <ChevronDown
            aria-hidden
            className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t px-3.5 py-3">
          <ThresholdForm productId={item.productId} threshold={item.threshold} />
        </div>
      </details>
    </div>
  );
}

function StockColumn({
  heading,
  stock,
  available,
  reserved,
  status,
  labels,
  format: number,
  highlight = false,
}: {
  heading: string;
  stock: number | null;
  available: number | null;
  reserved: number;
  status: ReturnType<typeof stockStatus> | null;
  labels: ReturnType<typeof useI18n>["messages"]["inventory"];
  format: (value: number) => string;
  highlight?: boolean;
}) {
  const empty = stock === null;
  return (
    <div
      className={cn(
        "grid min-w-0 content-start gap-1.5 rounded-xl px-3 py-2.5",
        highlight && !empty && "border bg-card",
      )}
    >
      <p className="caps text-[0.625rem] font-medium text-muted-foreground">{heading}</p>
      <p
        className={cn(
          "font-display text-3xl leading-none font-medium tabular-nums",
          empty && "text-muted-foreground/50",
        )}
      >
        {empty ? "—" : number(stock)}
      </p>
      <dl className="grid gap-0.5 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>{labels.adjust.available}</dt>
          <dd className="font-medium text-foreground tabular-nums">
            {available === null ? "—" : number(available)}
          </dd>
        </div>
        {reserved > 0 && (
          <div className="flex justify-between gap-2">
            <dt>{labels.adjust.reserved}</dt>
            <dd className="tabular-nums">{number(reserved)}</dd>
          </div>
        )}
      </dl>
      {status && (
        <div>
          <StockStatusBadge status={status} label={labels.status[status]} />
        </div>
      )}
    </div>
  );
}
