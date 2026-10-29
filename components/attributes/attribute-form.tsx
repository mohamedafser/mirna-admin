"use client";

import { ArrowDown, ArrowUp, LoaderCircle, Plus, Save, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveAttribute, type AttributeSaveResult } from "@/lib/attributes/actions";
import {
  ATTRIBUTE_DATA_TYPES,
  CODE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  isChoiceType,
  MAX_VALUES,
  NAME_MAX_LENGTH,
  readAttribute,
  UNIT_MAX_LENGTH,
  validateAttribute,
  VALUE_MAX_LENGTH,
  type AttributeDataType,
  type AttributeFieldError,
  type AttributeFormErrors,
} from "@/lib/attributes/rules";
import { slugify } from "@/lib/catalogue/slug";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { useUnsavedChanges } from "@/components/catalogue/use-unsaved-changes";
import { FormSection } from "./form-section";

export interface EditableAttribute {
  id: string;
  name: string;
  code: string;
  data_type: AttributeDataType;
  unit: string | null;
  allows_multiple: boolean;
  creates_variants: boolean;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  /** Product value rows using it: the data type is locked while > 0. */
  usageCount: number;
  values: Array<{
    id: string;
    value: string;
    colorHex: string | null;
    isActive: boolean;
    usageCount: number;
  }>;
}

interface ValueRow {
  /** Local key (stable across reorders). */
  key: string;
  /** "" for a value not saved yet. */
  id: string;
  value: string;
  colorHex: string;
  isActive: boolean;
  usageCount: number;
}

const DEFAULT_COLOR = "#000000";
const initialState: AttributeSaveResult = { status: "idle", fieldErrors: {}, at: 0 };

/**
 * Create / edit an attribute and, for SELECT / COLOR, its reusable values
 * (order, swatch, active). Saved together; values are inserted, updated and
 * removed in one database transaction. Values used by products can't be
 * removed (only deactivated), and the data type is locked once products use
 * the attribute.
 */
export function AttributeForm({ attribute }: { attribute?: EditableAttribute }) {
  const { locale, messages } = useI18n();
  const a = messages.attributes;
  const t = a.attrs;
  const f = t.fields;
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const [clientErrors, setClientErrors] = useState<AttributeFormErrors | null>(null);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState(attribute?.name ?? "");
  const [code, setCode] = useState(attribute?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(Boolean(attribute));
  const [dataType, setDataType] = useState<AttributeDataType>(attribute?.data_type ?? "SELECT");
  const [rows, setRows] = useState<ValueRow[]>(
    () =>
      attribute?.values.map((value) => ({
        key: value.id,
        id: value.id,
        value: value.value,
        colorHex: value.colorHex ?? DEFAULT_COLOR,
        isActive: value.isActive,
        usageCount: value.usageCount,
      })) ?? [],
  );
  useUnsavedChanges(dirty);

  const choice = isChoiceType(dataType);
  const typeLocked = (attribute?.usageCount ?? 0) > 0;
  const fieldErrors = clientErrors ?? state.fieldErrors;
  const errorText = (code?: AttributeFieldError) => code && a.errors[code];

  function changeRows(next: ValueRow[]) {
    setRows(next);
    setDirty(true);
  }

  function updateRow(key: string, patch: Partial<ValueRow>) {
    changeRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...rows];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    changeRows(next);
  }

  function addRow() {
    changeRows([
      ...rows,
      {
        key: crypto.randomUUID(),
        id: "",
        value: "",
        colorHex: DEFAULT_COLOR,
        isActive: true,
        usageCount: 0,
      },
    ]);
    // Focus the new value's input once it renders.
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLInputElement>("li:last-child input[type=text]")?.focus(),
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const errors = validateAttribute(readAttribute(data));
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      const first = Object.keys(errors).find((key) => key !== "valueRows");
      const target = first
        ? form.querySelector<HTMLElement>(`[data-field="${first}"], [name="${first}"]`)
        : form.querySelector<HTMLElement>("[data-value-row] [aria-invalid=true]");
      target?.focus();
      return;
    }
    setClientErrors(null);
    startTransition(async () => {
      const result = await saveAttribute(state, data);
      setState(result);
      if (result.status !== "success") return;
      setDirty(false);
      if (result.warning) toast.warning(a.errors[result.warning]);
      else toast.success(result.mode === "created" ? t.created : t.updated);
      router.push(`/${locale}/admin/attributes`);
    });
  }

  const serialized = JSON.stringify(
    rows.map(({ id: valueId, value, colorHex, isActive }) => ({
      id: valueId,
      value,
      colorHex,
      isActive,
    })),
  );

  return (
    <form
      onSubmit={onSubmit}
      onChange={() => setDirty(true)}
      noValidate
      aria-busy={pending}
      className="grid gap-4"
    >
      <input type="hidden" name="id" value={attribute?.id ?? ""} readOnly />
      <input type="hidden" name="updatedAt" value={attribute?.updated_at ?? ""} readOnly />
      <input type="hidden" name="values" value={choice ? serialized : "[]"} readOnly />

      {state.error && !pending && <Alert>{messages.catalogue.errors[state.error]}</Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <FormSection title={t.sections.basic}>
          <div className="grid gap-4 sm:grid-cols-2">
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
                    if (!codeTouched) {
                      setCode(slugify(event.target.value).slice(0, CODE_MAX_LENGTH));
                    }
                  }}
                />
              )}
            </Field>
            <Field
              id={`${id}-code`}
              label={f.code}
              error={errorText(fieldErrors.code)}
              hint={attribute && code !== attribute.code ? f.codeEditWarning : f.codeHint}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  name="code"
                  value={code}
                  dir="ltr"
                  maxLength={CODE_MAX_LENGTH}
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={pending}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setCodeTouched(event.target.value !== "");
                  }}
                  className="font-mono"
                />
              )}
            </Field>
          </div>
          <Field
            id={`${id}-type`}
            label={f.dataType}
            error={errorText(fieldErrors.dataType)}
            hint={typeLocked ? f.dataTypeLocked : a.dataTypeHints[dataType]}
          >
            {(a11y) => (
              <Combobox
                {...a11y}
                name="dataType"
                dataField="dataType"
                value={dataType}
                disabled={pending || typeLocked}
                onChange={(value) => {
                  setDataType(value as AttributeDataType);
                  setDirty(true);
                }}
                options={ATTRIBUTE_DATA_TYPES.map((type) => ({
                  value: type,
                  label: a.dataTypes[type],
                }))}
              />
            )}
          </Field>
          {dataType === "NUMBER" && (
            <Field
              id={`${id}-unit`}
              label={f.unit}
              optional={messages.catalogue.common.optional}
              hint={f.unitHint}
              error={errorText(fieldErrors.unit)}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  name="unit"
                  maxLength={UNIT_MAX_LENGTH}
                  disabled={pending}
                  defaultValue={attribute?.unit ?? ""}
                  className="sm:max-w-40"
                />
              )}
            </Field>
          )}
          {choice && (
            <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
              <input
                type="checkbox"
                name="allowsMultiple"
                data-field="allowsMultiple"
                disabled={pending}
                defaultChecked={attribute?.allows_multiple ?? false}
                aria-invalid={fieldErrors.allowsMultiple ? true : undefined}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{f.allowsMultiple}</span>
                <span className="block text-xs text-muted-foreground">{f.allowsMultipleHint}</span>
                {fieldErrors.allowsMultiple && (
                  <span role="alert" className="mt-1 block text-sm text-error">
                    {errorText(fieldErrors.allowsMultiple)}
                  </span>
                )}
              </span>
            </label>
          )}
          {choice && (
            <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
              <input
                type="checkbox"
                name="createsVariants"
                disabled={pending}
                defaultChecked={attribute?.creates_variants ?? true}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{f.createsVariants}</span>
                <span className="block text-xs text-muted-foreground">{f.createsVariantsHint}</span>
              </span>
            </label>
          )}
          <Field
            id={`${id}-description`}
            label={f.description}
            optional={messages.catalogue.common.optional}
            hint={f.descriptionHint}
            error={errorText(fieldErrors.description)}
          >
            {(a11y) => (
              <Textarea
                {...a11y}
                name="description"
                rows={2}
                maxLength={DESCRIPTION_MAX_LENGTH}
                disabled={pending}
                defaultValue={attribute?.description ?? ""}
                className="min-h-16"
              />
            )}
          </Field>
          <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              disabled={pending}
              defaultChecked={attribute?.is_active ?? true}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">{f.active}</span>
              <span className="block text-xs text-muted-foreground">{f.activeHint}</span>
            </span>
          </label>
        </FormSection>

        {choice && (
          <FormSection title={t.sections.values}>
            <p className="-mt-2 text-xs text-muted-foreground">{t.valuesHint}</p>
            {fieldErrors.values && (
              <p role="alert" className="text-sm text-error">
                {errorText(fieldErrors.values)}
              </p>
            )}
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                {t.noValues}
              </p>
            ) : (
              <ol ref={listRef} className="divide-y rounded-xl border">
                {rows.map((row, index) => {
                  const rowError = fieldErrors.valueRows?.[index];
                  const label = row.value || `#${index + 1}`;
                  return (
                    <li key={row.key} data-value-row className="grid gap-1.5 p-2.5">
                      <div className="flex items-center gap-2">
                        {dataType === "COLOR" && (
                          <input
                            type="color"
                            aria-label={`${t.colorLabel}: ${label}`}
                            value={row.colorHex}
                            disabled={pending}
                            onChange={(event) =>
                              updateRow(row.key, { colorHex: event.target.value.toUpperCase() })
                            }
                            className="size-9 shrink-0 cursor-pointer rounded-md border bg-card p-0.5"
                          />
                        )}
                        <input
                          type="text"
                          aria-label={`${t.valueLabel} ${index + 1}`}
                          aria-invalid={rowError ? true : undefined}
                          value={row.value}
                          maxLength={VALUE_MAX_LENGTH}
                          placeholder={t.valuePlaceholder}
                          disabled={pending}
                          onChange={(event) => updateRow(row.key, { value: event.target.value })}
                          className={cn(
                            "h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-base sm:text-sm",
                            "focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/15 focus-visible:outline-none aria-invalid:border-error",
                            !row.isActive && "text-muted-foreground line-through",
                          )}
                        />
                        <label
                          className="flex shrink-0 items-center gap-1.5 text-xs"
                          title={t.valueActive}
                        >
                          <input
                            type="checkbox"
                            checked={row.isActive}
                            disabled={pending}
                            onChange={(event) =>
                              updateRow(row.key, { isActive: event.target.checked })
                            }
                            className="size-4 accent-primary"
                          />
                          <span className="hidden sm:inline">{t.valueActive}</span>
                          <span className="sr-only sm:hidden">{t.valueActive}</span>
                        </label>
                        <div className="flex shrink-0">
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
                            disabled={pending || index === rows.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${a.remove}: ${label}`}
                            title={
                              row.usageCount > 0
                                ? format(t.valueInUse, { count: row.usageCount })
                                : a.remove
                            }
                            disabled={pending || row.usageCount > 0}
                            onClick={() => changeRows(rows.filter((item) => item.key !== row.key))}
                          >
                            <X aria-hidden />
                          </Button>
                        </div>
                      </div>
                      {(rowError || row.usageCount > 0) && (
                        <p
                          className={cn(
                            "text-xs",
                            rowError ? "text-sm text-error" : "text-muted-foreground",
                          )}
                        >
                          {rowError
                            ? errorText(rowError)
                            : format(t.valueInUse, { count: row.usageCount })}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={pending || rows.length >= MAX_VALUES}
              onClick={addRow}
            >
              <Plus aria-hidden />
              {t.addValue}
            </Button>
          </FormSection>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t bg-background/90 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border">
        <span className="me-auto truncate text-xs text-muted-foreground">
          {dirty && !pending ? messages.catalogue.common.unsaved : ""}
        </span>
        <Link
          href={`/${locale}/admin/attributes`}
          className={buttonClassName({ variant: "outline" })}
        >
          {messages.catalogue.common.cancel}
        </Link>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          {pending
            ? messages.catalogue.common.saving
            : attribute
              ? messages.catalogue.common.saveChanges
              : t.create}
        </Button>
      </div>
    </form>
  );
}
