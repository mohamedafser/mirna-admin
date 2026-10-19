"use client";

import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import {
  createCurrency,
  updateCurrencySymbol,
  type CurrencyFormResult,
} from "@/lib/currencies/actions";
import { formatMinor, type Currency } from "@/lib/currency/money";
import {
  currencyDefaults,
  isoCurrencyCodes,
  readCurrencyInput,
  SYMBOL_MAX_LENGTH,
  validateCurrencyInput,
  type CurrencyFieldError,
  type CurrencyFieldErrors,
} from "@/lib/currency/rules";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";

/**
 * "Add currency" button (with `existing`), or a row's edit button (with
 * `currency`), opening the currency form in a dialog. A new currency's code
 * and decimals are fixed once added (prices are stored in its minor units),
 * so editing changes the symbol only.
 */
export function CurrencyDialog(
  props: { existing: string[]; currency?: never } | { currency: Currency; existing?: never },
) {
  const { messages } = useI18n();
  const t = messages.currencies.dialog;
  const [open, setOpen] = useState(false);
  // Remount the form on every open so it starts from the latest data.
  const [session, setSession] = useState(0);
  const [pending, setPending] = useState(false);
  const show = () => {
    setSession((value) => value + 1);
    setOpen(true);
  };

  return (
    <>
      {props.currency ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(t.editNamed, { code: props.currency.code })}
          title={t.edit}
          onClick={show}
        >
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button onClick={show}>
          <Plus aria-hidden />
          {t.add}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={props.currency ? format(t.editNamed, { code: props.currency.code }) : t.add}
        description={props.currency ? t.editDescription : t.addDescription}
        dismissible={!pending}
        className="sm:max-w-lg"
      >
        <CurrencyForm
          key={session}
          currency={props.currency}
          existing={props.existing ?? []}
          onPending={setPending}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function CurrencyForm({
  currency,
  existing,
  onPending,
  onDone,
}: {
  currency?: Currency;
  existing: string[];
  onPending: (pending: boolean) => void;
  onDone: () => void;
}) {
  const { locale, messages } = useI18n();
  const t = messages.currencies.dialog;
  const toast = useToast();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState(currency?.code ?? "");
  const [symbol, setSymbol] = useState(currency?.symbol ?? "");
  const [decimals, setDecimals] = useState(currency ? String(currency.decimals) : "");
  // A symbol typed by the admin isn't replaced when another code is picked.
  const [symbolTouched, setSymbolTouched] = useState(Boolean(currency));
  const [errors, setErrors] = useState<CurrencyFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "currency" });
    } catch {
      return null;
    }
  }, [locale]);
  const label = (value: string) => {
    const name = names?.of(value);
    return name && name !== value ? `${value} — ${name}` : value;
  };
  const options = useMemo(
    () =>
      isoCurrencyCodes()
        .filter((value) => !existing.includes(value))
        .map((value) => ({ value, label: label(value) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `label` depends only on names
    [existing, names],
  );

  const errorText = (error?: CurrencyFieldError) => error && t.errors[error];

  function pickCode(value: string) {
    setCode(value);
    setErrors((current) => ({ ...current, code: undefined }));
    const defaults = currencyDefaults(value);
    if (!defaults) return;
    setDecimals(String(defaults.decimals));
    if (!symbolTouched) setSymbol(defaults.symbol);
  }

  function finish(result: CurrencyFormResult, success: string) {
    onPending(false);
    if (result.ok) {
      toast.success(success);
      onDone();
      return;
    }
    setErrors(result.fieldErrors);
    setFormError(result.error ? messages.currencies.errors[result.error] : null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setFormError(null);

    if (currency) {
      onPending(true);
      startTransition(async () =>
        finish(
          await updateCurrencySymbol(currency.code, symbol),
          format(t.updated, { code: currency.code }),
        ),
      );
      return;
    }

    const input = readCurrencyInput(data);
    const found = validateCurrencyInput(input, existing);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      const first = Object.keys(found)[0];
      event.currentTarget
        .querySelector<HTMLElement>(`[data-field="${first}"], [name="${first}"]`)
        ?.focus();
      return;
    }
    onPending(true);
    startTransition(async () =>
      finish(await createCurrency(data), format(t.created, { code: input.code })),
    );
  }

  // Live preview of how prices will look in the store.
  const digits = Number(decimals);
  const preview =
    code && /^[0-3]$/.test(decimals)
      ? (() => {
          try {
            return formatMinor(
              1234 * 10 ** digits + (digits > 0 ? 5 * 10 ** (digits - 1) : 0),
              { code, decimals: digits },
              locale,
            );
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {formError && !pending && <Alert>{formError}</Alert>}

      <fieldset className="grid gap-4" disabled={pending}>
        <Field
          id={`${id}-code`}
          label={t.code}
          hint={currency ? t.codeLocked : t.codeHint}
          error={errorText(errors.code)}
        >
          {(a11y) =>
            currency ? (
              <Input {...a11y} value={label(currency.code)} disabled readOnly />
            ) : (
              <Combobox
                {...a11y}
                name="code"
                dataField="code"
                searchable
                value={code}
                placeholder={t.codePlaceholder}
                onChange={pickCode}
                options={options}
              />
            )
          }
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${id}-symbol`}
            label={t.symbol}
            hint={t.symbolHint}
            error={errorText(errors.symbol)}
          >
            {(a11y) => (
              <Input
                {...a11y}
                name="symbol"
                value={symbol}
                maxLength={SYMBOL_MAX_LENGTH}
                dir="ltr"
                autoComplete="off"
                required
                onChange={(event) => {
                  setSymbol(event.target.value);
                  setSymbolTouched(true);
                  setErrors((current) => ({ ...current, symbol: undefined }));
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-decimals`}
            label={t.decimals}
            hint={currency ? t.decimalsLocked : t.decimalsHint}
            error={errorText(errors.decimals)}
          >
            {(a11y) =>
              currency ? (
                <Input {...a11y} value={String(currency.decimals)} disabled readOnly dir="ltr" />
              ) : (
                <Combobox
                  {...a11y}
                  name="decimals"
                  dataField="decimals"
                  value={decimals}
                  placeholder="—"
                  onChange={(value) => {
                    setDecimals(value);
                    setErrors((current) => ({ ...current, decimals: undefined }));
                  }}
                  options={["0", "1", "2", "3"].map((value) => ({
                    value,
                    label: format(t.decimalsOption, { count: value }),
                  }))}
                />
              )
            }
          </Field>
        </div>

        {!currency && (
          <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">{t.enableNow}</span>
              <span className="block text-xs text-muted-foreground">{t.enableNowHint}</span>
            </span>
          </label>
        )}

        {preview && (
          <p className="rounded-xl bg-muted/50 px-3.5 py-3 text-sm">
            <span className="text-muted-foreground">{t.preview}: </span>
            <span className="font-medium tabular-nums">{preview}</span>
          </p>
        )}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={pending} onClick={onDone}>
          {messages.catalogue.common.cancel}
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle aria-hidden className="animate-spin" />}
          {pending ? messages.catalogue.common.saving : currency ? t.save : t.add}
        </Button>
      </div>
    </form>
  );
}
