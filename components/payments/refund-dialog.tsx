"use client";

import { LoaderCircle, Undo2 } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { controlClassName, Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatMinor, minorToDecimal, parseMinor } from "@/lib/currency/money";
import { toIntlLocale } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import { refundPayment, type PaymentActionResult } from "@/lib/payments/actions";
import { REFUND_REASONS, type RefundReason } from "@/lib/payments/rules";
import { cn } from "@/lib/utils/cn";

/**
 * "Refund" for a captured payment: amount (prefilled with everything still
 * refundable), reason and an internal note. The server re-checks the amount
 * and Stripe checks it again. One request key per opening of the dialog, so
 * a double submit or a retry after a timeout can't refund twice.
 */
export function RefundDialog({
  paymentId,
  orderNumber,
  currency,
  refundableMinor,
}: {
  paymentId: string;
  orderNumber: number;
  currency: { code: string; decimals: number };
  /** Still refundable, in minor units (as a string: exact for any amount). */
  refundableMinor: string;
}) {
  const { locale, messages } = useI18n();
  const t = messages.orders.payment;
  const toast = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<RefundReason>("requested_by_customer");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const max = BigInt(refundableMinor);
  const money = (minor: bigint) => formatMinor(minor, currency, toIntlLocale(locale));
  const parsed = parseMinor(amount, currency.decimals);
  const tooLarge = parsed.ok && parsed.minor > max;

  function show() {
    setRequestKey(crypto.randomUUID());
    setAmount(minorToDecimal(max, currency.decimals));
    setReason("requested_by_customer");
    setNote("");
    setError(null);
    setOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!parsed.ok) return setError(t.errors.amountInvalid);
    if (tooLarge) return setError(t.errors.amountTooLarge);
    setError(null);
    startTransition(async () => {
      const result = await refundPayment({ paymentId, amount, reason, note, requestKey }).catch(
        (): PaymentActionResult => ({ ok: false, error: "unexpected" }),
      );
      if (result.ok) {
        toast.success(format(t.refundSent, { amount: money(parsed.minor) }));
        setOpen(false);
      } else {
        setError(format(t.errors[result.error], { detail: result.detail ?? "" }));
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={show}>
        <Undo2 aria-hidden />
        {t.refund}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        dismissible={!pending}
        title={format(t.refundTitle, { number: orderNumber })}
        description={format(t.refundBody, { amount: money(max) })}
      >
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field
            id={`${id}-amount`}
            label={`${t.refundAmount} (${currency.code})`}
            error={tooLarge ? t.errors.amountTooLarge : undefined}
            hint={t.refundFullNote}
          >
            {(a11y) => (
              <div className="flex gap-2">
                <Input
                  {...a11y}
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  value={amount}
                  disabled={pending}
                  onChange={(event) => setAmount(event.target.value)}
                  className="tabular-nums"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11"
                  disabled={pending}
                  onClick={() => setAmount(minorToDecimal(max, currency.decimals))}
                >
                  {t.refundAll}
                </Button>
              </div>
            )}
          </Field>
          <Field id={`${id}-reason`} label={t.refundReason}>
            {(a11y) => (
              <select
                {...a11y}
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value as RefundReason)}
                className={cn(controlClassName, "h-11")}
              >
                {REFUND_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {t.reasons[value]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-note`}
            label={t.refundNote}
            optional={messages.catalogue.common.optional}
            hint={t.refundNoteHint}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                rows={2}
                maxLength={500}
                value={note}
                disabled={pending}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {messages.catalogue.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={pending || !parsed.ok || tooLarge}
              aria-busy={pending}
              className="bg-error text-error-foreground hover:bg-error/90"
            >
              {pending && <LoaderCircle aria-hidden className="animate-spin" />}
              {format(t.refundSubmit, { amount: parsed.ok ? money(parsed.minor) : "" })}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
