"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { addShippingCountry } from "@/lib/shipping/actions";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { countryLabel } from "./format";

/**
 * "Add country": picks one of the countries the store sells in that has no
 * shipping configuration yet, creates it (disabled, draft methods) and opens
 * its details page to set the rates.
 */
export function AddCountryDialog({
  available,
}: {
  /** Not yet configured countries from country_currency, with their currency. */
  available: { countryCode: string; currencyCode: string }[];
}) {
  const { locale, messages } = useI18n();
  const t = messages.shipping.add;
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = available
    .map((row) => ({
      value: row.countryCode,
      label: `${countryLabel(row.countryCode, locale)} (${row.currencyCode})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  function show() {
    setCountry("");
    setError(null);
    setOpen(true);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!country) {
      setError(messages.shipping.add.placeholder);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addShippingCountry(country);
      if (!result.ok) {
        setError(messages.shipping.errors[result.error]);
        return;
      }
      toast.success(format(t.added, { country: countryLabel(country, locale) }));
      setOpen(false);
      router.push(`/${locale}/admin/shipping/${country}`);
    });
  }

  return (
    <>
      <Button onClick={show}>
        <Plus aria-hidden />
        {t.button}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t.title}
        description={t.description}
        dismissible={!pending}
        className="sm:max-w-lg"
      >
        {options.length === 0 ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t.none}</p>
            <div className="flex justify-end border-t pt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {messages.catalogue.common.close}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="grid gap-5">
            {error && !pending && <Alert>{error}</Alert>}
            <Field id={`${id}-country`} label={t.country}>
              {(a11y) => (
                <Combobox
                  {...a11y}
                  dataField="country"
                  searchable="auto"
                  value={country}
                  placeholder={t.placeholder}
                  onChange={(value) => {
                    setCountry(value);
                    setError(null);
                  }}
                  options={options}
                  disabled={pending}
                />
              )}
            </Field>
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {messages.catalogue.common.cancel}
              </Button>
              <Button type="submit" disabled={pending || !country} aria-busy={pending}>
                {pending && <LoaderCircle aria-hidden className="animate-spin" />}
                {t.submit}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
