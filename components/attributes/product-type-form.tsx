"use client";

import { ArrowDown, ArrowUp, LoaderCircle, Save, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveProductType, type ProductTypeFormResult } from "@/lib/attributes/actions";
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  readProductType,
  validateProductType,
  type AttributeDefinition,
  type AttributeFieldError,
  type ProductTypeFieldErrors,
  type TypeAttributeInput,
} from "@/lib/attributes/rules";
import { slugify } from "@/lib/catalogue/slug";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { useUnsavedChanges } from "@/components/catalogue/use-unsaved-changes";
import { FormSection } from "./form-section";

export interface EditableProductType {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  attributes: TypeAttributeInput[];
}

const initialState: ProductTypeFormResult = { status: "idle", fieldErrors: {}, at: 0 };

/**
 * Create / edit a product type: its details and its default attributes
 * (required flag + display order). Everything is saved together; the
 * attribute list is replaced in one database transaction.
 */
export function ProductTypeForm({
  productType,
  attributes,
}: {
  productType?: EditableProductType;
  /** Every attribute (inactive ones only show when already assigned). */
  attributes: AttributeDefinition[];
}) {
  const { locale, messages } = useI18n();
  const a = messages.attributes;
  const t = a.types;
  const f = t.fields;
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const [clientErrors, setClientErrors] = useState<ProductTypeFieldErrors | null>(null);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState(productType?.name ?? "");
  const [slug, setSlug] = useState(productType?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(productType));
  const [assigned, setAssigned] = useState<TypeAttributeInput[]>(productType?.attributes ?? []);
  useUnsavedChanges(dirty);

  const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const fieldErrors = clientErrors ?? state.fieldErrors;
  const errorText = (code?: AttributeFieldError) =>
    code === "slugTaken" ? t.slugTaken : code && a.errors[code];
  const available = attributes.filter(
    (attribute) =>
      attribute.isActive && !assigned.some((item) => item.attributeId === attribute.id),
  );

  function change(next: TypeAttributeInput[]) {
    setAssigned(next);
    setDirty(true);
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...assigned];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    change(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const errors = validateProductType(readProductType(data));
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      form.querySelector<HTMLElement>(`[name="${Object.keys(errors)[0]}"]`)?.focus();
      return;
    }
    setClientErrors(null);
    startTransition(async () => {
      const result = await saveProductType(state, data);
      setState(result);
      if (result.status !== "success") return;
      setDirty(false);
      if (result.warning) toast.warning(a.errors[result.warning]);
      else toast.success(result.mode === "created" ? t.created : t.updated);
      router.push(`/${locale}/admin/product-types`);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      onChange={() => setDirty(true)}
      noValidate
      aria-busy={pending}
      className="grid gap-4"
    >
      <input type="hidden" name="id" value={productType?.id ?? ""} readOnly />
      <input type="hidden" name="updatedAt" value={productType?.updated_at ?? ""} readOnly />
      <input type="hidden" name="attributes" value={JSON.stringify(assigned)} readOnly />

      {state.error && !pending && <Alert>{messages.catalogue.errors[state.error]}</Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <FormSection title={t.sections.basic}>
          <Field id={`${id}-name`} label={f.name} error={errorText(fieldErrors.name)}>
            {(a11y) => (
              <Input
                {...a11y}
                name="name"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                required
                disabled={pending}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugTouched) setSlug(slugify(event.target.value));
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-slug`}
            label={f.slug}
            error={errorText(fieldErrors.slug)}
            hint={productType && slug !== productType.slug ? f.slugEditWarning : f.slugHint}
          >
            {(a11y) => (
              <Input
                {...a11y}
                name="slug"
                value={slug}
                dir="ltr"
                maxLength={200}
                required
                autoCapitalize="none"
                spellCheck={false}
                disabled={pending}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setSlugTouched(event.target.value !== "");
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-description`}
            label={f.description}
            optional={messages.catalogue.common.optional}
            error={errorText(fieldErrors.description)}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                name="description"
                rows={3}
                maxLength={DESCRIPTION_MAX_LENGTH}
                disabled={pending}
                defaultValue={productType?.description ?? ""}
              />
            )}
          </Field>
          <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              disabled={pending}
              defaultChecked={productType?.is_active ?? true}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">{f.active}</span>
              <span className="block text-xs text-muted-foreground">{f.activeHint}</span>
            </span>
          </label>
        </FormSection>

        <FormSection title={t.sections.attributes}>
          <p className="-mt-2 text-xs text-muted-foreground">{t.attributesHint}</p>
          {fieldErrors.attributes && (
            <p role="alert" className="text-sm text-error">
              {errorText(fieldErrors.attributes)}
            </p>
          )}

          {assigned.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t.noAttributes}
            </p>
          ) : (
            <ol className="divide-y rounded-xl border">
              {assigned.map((item, index) => {
                const attribute = byId.get(item.attributeId);
                const label = attribute?.name ?? item.attributeId;
                return (
                  <li key={item.attributeId} className="flex flex-wrap items-center gap-2 p-2.5">
                    <span className="w-6 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <bdi>
                          {attribute && !attribute.isActive
                            ? format(t.attributeInactive, { name: label })
                            : label}
                        </bdi>
                      </p>
                      {attribute && (
                        <p className="truncate text-xs text-muted-foreground">
                          {a.dataTypes[attribute.dataType]}
                          {attribute.unit && ` · ${attribute.unit}`}
                        </p>
                      )}
                    </div>
                    <label
                      className="flex items-center gap-2 text-xs font-medium"
                      title={t.requiredHint}
                    >
                      <input
                        type="checkbox"
                        checked={item.isRequired}
                        disabled={pending}
                        onChange={(event) =>
                          change(
                            assigned.map((entry, position) =>
                              position === index
                                ? { ...entry, isRequired: event.target.checked }
                                : entry,
                            ),
                          )
                        }
                        className="size-4 accent-primary"
                      />
                      {a.required}
                    </label>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${a.moveUp}: ${label}`}
                        title={a.moveUp}
                        disabled={pending || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${a.moveDown}: ${label}`}
                        title={a.moveDown}
                        disabled={pending || index === assigned.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${a.remove}: ${label}`}
                        title={a.remove}
                        disabled={pending}
                        onClick={() => change(assigned.filter((_, position) => position !== index))}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Combobox
              aria-label={t.addAttribute}
              value=""
              placeholder={available.length > 0 ? t.addAttributePlaceholder : t.noMoreAttributes}
              disabled={pending || available.length === 0}
              onChange={(attributeId) => change([...assigned, { attributeId, isRequired: false }])}
              options={available.map((attribute) => ({
                value: attribute.id,
                label: `${attribute.name} · ${a.dataTypes[attribute.dataType]}`,
              }))}
            />
            <Link
              href={`/${locale}/admin/attributes`}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t.manageAttributes}
            </Link>
          </div>
          {assigned.some((item) => item.isRequired) && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge tone="primary">{a.required}</Badge>
              {t.requiredHint}
            </p>
          )}
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t bg-background/90 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border">
        <span className="me-auto truncate text-xs text-muted-foreground">
          {dirty && !pending ? messages.catalogue.common.unsaved : ""}
        </span>
        <Link
          href={`/${locale}/admin/product-types`}
          className={buttonClassName({ variant: "outline" })}
        >
          {messages.catalogue.common.cancel}
        </Link>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          {pending
            ? messages.catalogue.common.saving
            : productType
              ? messages.catalogue.common.saveChanges
              : t.create}
        </Button>
      </div>
    </form>
  );
}
