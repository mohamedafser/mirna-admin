"use client";

import { Check, ImageOff, LoaderCircle, Pencil } from "lucide-react";
import Image from "next/image";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useUnsavedChanges } from "@/components/catalogue/use-unsaved-changes";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { currencyFractionDigits, moneyInputValue } from "@/lib/money";
import { gramsToKg } from "@/lib/shipping/rules";
import { cn } from "@/lib/utils/cn";
import { saveVariant, type VariantFormResult } from "@/lib/variants/actions";
import {
  readVariant,
  SKU_MAX_LENGTH,
  validateVariant,
  type VariantFieldError,
  type VariantFieldErrors,
} from "@/lib/variants/rules";

export interface EditableVariant {
  id: string;
  label: string;
  sku: string;
  price: number | string;
  compare_at_price: number | string | null;
  image_id: string | null;
  is_active: boolean;
  updated_at: string;
  /** Own shipping weight in grams (null: the product's); undefined before migration 038. */
  weight_grams?: number | null;
}

export interface VariantImage {
  id: string;
  public_url: string | null;
  alt_text: string | null;
}

/** Icon button that opens the variant editor in a dialog. */
export function VariantDialog({
  variant,
  currency,
  images,
}: {
  variant: EditableVariant;
  /** The product's currency (variants are priced in it). */
  currency: string;
  /** The product's images (a variant picks one of them). */
  images: VariantImage[];
}) {
  const { messages } = useI18n();
  const t = messages.variants.edit;
  const [open, setOpen] = useState(false);
  // Remount the form on every open so it starts from the latest data.
  const [session, setSession] = useState(0);

  return (
    <>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={format(t.button, { name: variant.label || variant.sku })}
        title={messages.catalogue.common.edit}
        onClick={() => {
          setSession((value) => value + 1);
          setOpen(true);
        }}
      >
        <Pencil aria-hidden />
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t.title}
        description={
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <bdi className="truncate font-medium text-foreground">{variant.label}</bdi>
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs" dir="ltr">
              {variant.sku}
            </span>
          </span>
        }
        className="sm:max-w-xl"
      >
        <VariantForm
          key={session}
          variant={variant}
          currency={currency}
          images={images}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

const initialState: VariantFormResult = { status: "idle", fieldErrors: {}, at: 0 };

function VariantForm({
  variant,
  currency,
  images,
  onDone,
}: {
  variant: EditableVariant;
  currency: string;
  images: VariantImage[];
  onDone: () => void;
}) {
  const { messages } = useI18n();
  const v = messages.variants;
  const t = v.edit;
  const toast = useToast();
  const id = useId();
  const [state, setState] = useState(initialState);
  const [clientErrors, setClientErrors] = useState<VariantFieldErrors | null>(null);
  const [imageId, setImageId] = useState(variant.image_id ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  useUnsavedChanges(dirty);

  const fieldErrors = clientErrors ?? state.fieldErrors;
  const errorText = (code?: VariantFieldError) => {
    if (!code) return undefined;
    if (code === "moneyTooManyDecimals") {
      return format(messages.catalogue.errors.moneyTooManyDecimals, {
        digits: currencyFractionDigits(currency),
      });
    }
    return code in v.errors
      ? v.errors[code as keyof typeof v.errors]
      : messages.catalogue.errors[code as keyof typeof messages.catalogue.errors];
  };
  const formError =
    state.error && !pending && !Object.keys(state.fieldErrors).length
      ? state.error in v.errors
        ? v.errors[state.error as keyof typeof v.errors]
        : messages.catalogue.errors[state.error as keyof typeof messages.catalogue.errors]
      : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const errors = validateVariant(readVariant(data), currency);
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      form.querySelector<HTMLElement>(`[name="${Object.keys(errors)[0]}"]`)?.focus();
      return;
    }
    setClientErrors(null);
    startTransition(async () => {
      try {
        const result = await saveVariant(state, data);
        setState(result);
        if (result.status !== "success") return;
        setDirty(false);
        toast.success(v.updated);
        onDone();
      } catch {
        setState({ status: "error", error: "network", fieldErrors: {}, at: Date.now() });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} onChange={() => setDirty(true)} noValidate className="grid gap-5">
      <input type="hidden" name="id" value={variant.id} readOnly />
      <input type="hidden" name="updatedAt" value={variant.updated_at} readOnly />
      <input type="hidden" name="imageId" value={imageId} readOnly />

      {formError && <Alert>{formError}</Alert>}

      <fieldset className="grid gap-4" disabled={pending}>
        <Field id={`${id}-sku`} label={t.sku} hint={t.skuHint} error={errorText(fieldErrors.sku)}>
          {(a11y) => (
            <Input
              {...a11y}
              name="sku"
              dir="ltr"
              maxLength={SKU_MAX_LENGTH}
              required
              autoCapitalize="characters"
              spellCheck={false}
              defaultValue={variant.sku}
              className="font-mono"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${id}-price`}
            label={`${t.price} (${currency})`}
            error={errorText(fieldErrors.price)}
          >
            {(a11y) => (
              <Input
                {...a11y}
                name="price"
                inputMode="decimal"
                dir="ltr"
                required
                autoComplete="off"
                defaultValue={moneyInputValue(variant.price, currency)}
              />
            )}
          </Field>
          <Field
            id={`${id}-compare`}
            label={t.compareAtPrice}
            optional={messages.catalogue.common.optional}
            error={errorText(fieldErrors.compareAtPrice)}
          >
            {(a11y) => (
              <Input
                {...a11y}
                name="compareAtPrice"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                defaultValue={moneyInputValue(variant.compare_at_price, currency)}
              />
            )}
          </Field>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">{t.compareAtHint}</p>
        {variant.weight_grams !== undefined && (
          <Field
            id={`${id}-weight`}
            label={t.weight}
            optional={messages.catalogue.common.optional}
            hint={t.weightHint}
            error={errorText(fieldErrors.weight)}
          >
            {(a11y) => (
              <Input
                {...a11y}
                name="weight"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                defaultValue={variant.weight_grams ? gramsToKg(variant.weight_grams) : ""}
              />
            )}
          </Field>
        )}
      </fieldset>

      <fieldset className="grid gap-2" disabled={pending}>
        <legend className="mb-1 text-sm font-medium">{t.image}</legend>
        {images.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noImages}</p>
        ) : (
          <div role="radiogroup" aria-label={t.image} className="flex flex-wrap gap-2">
            {[{ id: "", public_url: null, alt_text: null } as VariantImage, ...images].map(
              (image) => {
                const selected = imageId === image.id;
                return (
                  <button
                    key={image.id || "none"}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={image.id ? image.alt_text || t.image : t.imageNone}
                    title={image.id ? undefined : t.imageNone}
                    onClick={() => {
                      setImageId(image.id);
                      setDirty(true);
                    }}
                    className={cn(
                      "relative grid size-16 place-items-center overflow-hidden rounded-md border bg-muted transition-shadow",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                      selected ? "border-foreground ring-2 ring-foreground" : "hover:border-input",
                    )}
                  >
                    {image.public_url ? (
                      <Image
                        src={image.public_url}
                        alt=""
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <ImageOff aria-hidden className="size-5 text-muted-foreground" />
                    )}
                    {selected && (
                      <span className="absolute end-1 top-1 grid size-4 place-items-center rounded-full bg-foreground text-background">
                        <Check aria-hidden className="size-3" />
                      </span>
                    )}
                  </button>
                );
              },
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {fieldErrors.imageId ? (
            <span className="text-sm text-error">{errorText(fieldErrors.imageId)}</span>
          ) : (
            t.imageHint
          )}
        </p>
      </fieldset>

      <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
        <input
          type="checkbox"
          name="isActive"
          disabled={pending}
          defaultChecked={variant.is_active}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          <span className="block font-medium">{t.active}</span>
          <span className="block text-xs text-muted-foreground">{t.activeHint}</span>
        </span>
      </label>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={pending} onClick={onDone}>
          {messages.catalogue.common.cancel}
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle aria-hidden className="animate-spin" />}
          {pending ? messages.catalogue.common.saving : messages.catalogue.common.saveChanges}
        </Button>
      </div>
    </form>
  );
}
