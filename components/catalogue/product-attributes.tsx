"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/form";
import {
  emptyEntry,
  isEntryEmpty,
  TEXT_VALUE_MAX_LENGTH,
  type AttributeCatalog,
  type AttributeDefinition,
  type AttributeEntry,
  type ProductAttributeError,
  type SavedProductAttributes,
} from "@/lib/attributes/rules";
import type { CatalogueFieldError } from "@/lib/catalogue/validation";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * Product type + attribute values for the product form, loaded dynamically
 * from the chosen type: its default attributes (in order, with required
 * markers), plus extra attributes added for this product only.
 *
 * Changing the type keeps values already entered: those whose attribute isn't
 * part of the new type stay as extras (removable), so nothing is lost silently.
 *
 * Submits two fields with the surrounding form: `productTypeId` and
 * `attributes` (JSON entries for the attributes shown). Validation runs in
 * the form (lib/attributes/rules.ts), and again on the server and database.
 */
export function ProductAttributes({
  catalog,
  saved,
  errors,
  typeError,
  disabled,
  onChange,
}: {
  catalog: AttributeCatalog;
  /** The product's current type and values (edit), null for a new product. */
  saved: SavedProductAttributes | null;
  errors: Record<string, ProductAttributeError>;
  typeError?: CatalogueFieldError;
  disabled: boolean;
  onChange: () => void;
}) {
  const { locale, messages } = useI18n();
  const a = messages.attributes;
  const p = a.product;
  const id = useId();
  const attributes = new Map(catalog.attributes.map((attribute) => [attribute.id, attribute]));
  // A type's attributes, minus deactivated ones (kept only where this product
  // already has a value for them).
  const typeAttributes = (typeId: string) =>
    (catalog.types.find((type) => type.id === typeId)?.attributes ?? []).filter(
      (item) =>
        attributes.get(item.attributeId)?.isActive ||
        saved?.entries.some((entry) => entry.attributeId === item.attributeId),
    );

  const [typeId, setTypeId] = useState(saved?.productTypeId ?? "");
  const [entries, setEntries] = useState(
    () => new Map(saved?.entries.map((entry) => [entry.attributeId, entry])),
  );
  // Attributes shown in addition to the type's (saved values outside the type).
  const [extras, setExtras] = useState(() => {
    const inType = new Set(typeAttributes(saved?.productTypeId ?? "").map((i) => i.attributeId));
    return (saved?.entries ?? [])
      .map((entry) => entry.attributeId)
      .filter((attributeId) => !inType.has(attributeId) && attributes.has(attributeId));
  });

  const required = new Map(
    typeAttributes(typeId).map((item) => [
      item.attributeId,
      item.isRequired && attributes.get(item.attributeId)?.isActive === true,
    ]),
  );
  const shown = [
    ...typeAttributes(typeId).map((item) => item.attributeId),
    ...extras.filter((attributeId) => !required.has(attributeId)),
  ].filter((attributeId) => attributes.has(attributeId));
  const entryOf = (attributeId: string) => entries.get(attributeId) ?? emptyEntry(attributeId);

  function update(attributeId: string, patch: Partial<AttributeEntry>) {
    setEntries((current) =>
      new Map(current).set(attributeId, {
        ...(current.get(attributeId) ?? emptyEntry(attributeId)),
        ...patch,
      }),
    );
    onChange();
  }

  function changeType(nextTypeId: string) {
    const nextIds = new Set(typeAttributes(nextTypeId).map((item) => item.attributeId));
    // Keep filled-in attributes the new type doesn't have, as extras.
    setExtras(
      shown.filter((attributeId) => {
        const attribute = attributes.get(attributeId)!;
        return !nextIds.has(attributeId) && !isEntryEmpty(entryOf(attributeId), attribute.dataType);
      }),
    );
    setTypeId(nextTypeId);
    onChange();
  }

  function removeExtra(attributeId: string) {
    setExtras((current) => current.filter((item) => item !== attributeId));
    setEntries((current) => {
      const next = new Map(current);
      next.delete(attributeId);
      return next;
    });
    onChange();
  }

  const typeOptions = [
    { value: "", label: p.typeNone },
    ...catalog.types
      .filter((type) => type.isActive || type.id === saved?.productTypeId)
      .map((type) => ({
        value: type.id,
        label: type.isActive ? type.name : format(p.typeInactive, { name: type.name }),
      })),
  ];
  const addable = catalog.attributes.filter(
    (attribute) => attribute.isActive && !shown.includes(attribute.id),
  );
  const serialized = JSON.stringify(shown.map(entryOf));

  return (
    <div className="grid gap-4">
      <input type="hidden" name="attributes" value={serialized} readOnly />
      <Field
        id={`${id}-type`}
        label={p.type}
        optional={messages.catalogue.common.optional}
        hint={
          catalog.types.length === 0 ? (
            <>
              {p.noTypes}{" "}
              <Link
                href={`/${locale}/admin/product-types`}
                className="font-medium underline underline-offset-4"
              >
                {p.manageTypes}
              </Link>
            </>
          ) : (
            p.typeHint
          )
        }
        error={typeError && messages.catalogue.errors[typeError]}
      >
        {(a11y) => (
          <Combobox
            {...a11y}
            name="productTypeId"
            dataField="productTypeId"
            value={typeId}
            disabled={disabled}
            onChange={changeType}
            options={typeOptions}
          />
        )}
      </Field>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          {p.noAttributes}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((attributeId) => {
            const attribute = attributes.get(attributeId)!;
            const isExtra = !required.has(attributeId);
            const error = errors[attributeId];
            return (
              <AttributeInput
                key={attributeId}
                fieldId={`${id}-attr-${attributeId}`}
                attribute={attribute}
                entry={entryOf(attributeId)}
                required={required.get(attributeId) === true}
                error={error && a.errors[error]}
                disabled={disabled}
                onChange={(patch) => update(attributeId, patch)}
                badge={
                  isExtra ? (
                    <span className="ms-auto flex items-center gap-1">
                      <Badge>{p.extra}</Badge>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={format(p.removeAttribute, { name: attribute.name })}
                        title={format(p.removeAttribute, { name: attribute.name })}
                        disabled={disabled}
                        onClick={() => removeExtra(attributeId)}
                        className="-my-1.5"
                      >
                        <X aria-hidden />
                      </Button>
                    </span>
                  ) : required.get(attributeId) ? (
                    <Badge tone="primary" className="ms-auto">
                      {a.required}
                    </Badge>
                  ) : null
                }
              />
            );
          })}
        </div>
      )}

      {addable.length > 0 && (
        <Combobox
          aria-label={p.addAttribute}
          value=""
          placeholder={p.addAttributePlaceholder}
          disabled={disabled}
          onChange={(attributeId) => {
            setExtras((current) => [...current, attributeId]);
            onChange();
          }}
          options={addable.map((attribute) => ({
            value: attribute.id,
            label: `${attribute.name} · ${a.dataTypes[attribute.dataType]}`,
          }))}
          className="sm:max-w-sm"
        />
      )}
    </div>
  );
}

/** One attribute's control, chosen by its data type. */
function AttributeInput({
  fieldId,
  attribute,
  entry,
  required,
  error,
  disabled,
  onChange,
  badge,
}: {
  fieldId: string;
  attribute: AttributeDefinition;
  entry: AttributeEntry;
  required: boolean;
  error?: string;
  disabled: boolean;
  onChange: (patch: Partial<AttributeEntry>) => void;
  badge: ReactNode;
}) {
  const { messages } = useI18n();
  const a = messages.attributes;
  const labelId = `${fieldId}-label`;
  const errorId = `${fieldId}-error`;
  // Chip toggles: COLOR (with swatches) and multi-value SELECT.
  const chips =
    attribute.dataType === "COLOR" || (attribute.dataType === "SELECT" && attribute.allowsMultiple);
  const a11y = {
    id: fieldId,
    "aria-describedby": error ? errorId : undefined,
    "aria-invalid": error ? (true as const) : undefined,
  };
  // Active values, plus inactive ones this product already uses.
  const values = attribute.values.filter(
    (value) => value.isActive || entry.valueIds.includes(value.id),
  );
  const valueLabel = (value: { value: string; isActive: boolean }) =>
    value.isActive ? value.value : format(a.product.valueInactive, { name: value.value });

  function toggle(valueId: string) {
    const selected = entry.valueIds.includes(valueId);
    onChange({
      valueIds: selected
        ? entry.valueIds.filter((item) => item !== valueId)
        : attribute.allowsMultiple
          ? [...entry.valueIds, valueId]
          : [valueId],
    });
  }

  let control: ReactNode;
  if (chips) {
    control = (
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={a11y["aria-describedby"]}
        className="flex flex-wrap gap-2"
      >
        {values.map((value, index) => {
          const selected = entry.valueIds.includes(value.id);
          return (
            <button
              key={value.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => toggle(value.id)}
              data-attribute={index === 0 ? attribute.id : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-ring/15 focus-visible:outline-none disabled:opacity-60",
                selected
                  ? "border-foreground bg-accent font-medium text-accent-foreground"
                  : "border-border bg-card hover:border-input",
                error && !selected && "border-error/60",
              )}
            >
              {attribute.dataType === "COLOR" && (
                <span
                  aria-hidden
                  className="size-4 shrink-0 rounded-full border"
                  style={{ backgroundColor: value.colorHex ?? "transparent" }}
                />
              )}
              <bdi>{valueLabel(value)}</bdi>
              {selected && <Check aria-hidden className="size-3.5" />}
            </button>
          );
        })}
      </div>
    );
  } else if (attribute.dataType === "SELECT") {
    control = (
      <Combobox
        {...a11y}
        dataField={attribute.id}
        value={entry.valueIds[0] ?? ""}
        disabled={disabled}
        onChange={(valueId) => onChange({ valueIds: valueId ? [valueId] : [] })}
        options={[
          { value: "", label: a.notSet },
          ...values.map((value) => ({ value: value.id, label: valueLabel(value) })),
        ]}
      />
    );
  } else if (attribute.dataType === "BOOLEAN") {
    control = (
      <Combobox
        {...a11y}
        dataField={attribute.id}
        value={entry.boolean}
        disabled={disabled}
        onChange={(value) => onChange({ boolean: value as AttributeEntry["boolean"] })}
        options={[
          { value: "", label: a.notSet },
          { value: "true", label: a.yes },
          { value: "false", label: a.no },
        ]}
      />
    );
  } else if (attribute.dataType === "NUMBER") {
    control = (
      <Input
        {...a11y}
        data-attribute={attribute.id}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        disabled={disabled}
        value={entry.number}
        onChange={(event) => onChange({ number: event.target.value })}
        trailing={
          attribute.unit ? (
            <span className="pe-3 text-sm text-muted-foreground">{attribute.unit}</span>
          ) : undefined
        }
      />
    );
  } else {
    control = (
      <Input
        {...a11y}
        data-attribute={attribute.id}
        maxLength={TEXT_VALUE_MAX_LENGTH}
        disabled={disabled}
        value={entry.text}
        onChange={(event) => onChange({ text: event.target.value })}
      />
    );
  }

  const name = (
    <>
      <bdi className="truncate">{attribute.name}</bdi>
      {required && <span className="sr-only"> ({a.required})</span>}
    </>
  );

  return (
    <div className={cn("grid content-start gap-2", chips && "sm:col-span-2")}>
      <div className="flex min-h-5 min-w-0 items-center gap-2">
        {chips ? (
          <span id={labelId} className="flex min-w-0 text-sm font-medium">
            {name}
          </span>
        ) : (
          <label id={labelId} htmlFor={fieldId} className="flex min-w-0 text-sm font-medium">
            {name}
          </label>
        )}
        {badge}
      </div>
      {control}
      {error && (
        <p id={errorId} className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
