"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { createSubcategory } from "@/lib/catalogue/actions";
import { NAME_MAX_LENGTH } from "@/lib/catalogue/validation";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";

export interface CategoryChoice {
  id: string;
  /** Own name ("Abaya"). */
  shortName: string;
  /** Full label ("Women › Abaya"); falls back to shortName. */
  name?: string;
  isActive: boolean;
  /** null = top-level category. */
  parentId: string | null;
}

const NEW = "__new__";

/**
 * Two-step category choice for a product, matching the storefront menu:
 * a top-level category (Women, Kids), then optionally one of its
 * subcategories, or "+ New subcategory" to create one on the spot. Submits a
 * single `categoryId`: the subcategory when chosen, else the category.
 */
export function CategoryPicker({
  idPrefix,
  categories,
  currentId,
  disabled,
  error,
  onChange,
  onSelect,
}: {
  idPrefix: string;
  /** Selectable categories (active, plus the product's current one). */
  categories: CategoryChoice[];
  currentId: string | null;
  disabled: boolean;
  error?: string;
  onChange: () => void;
  /** The effective category id (subcategory when chosen, else the category). */
  onSelect?: (categoryId: string) => void;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const f = t.products.fields;
  const toast = useToast();
  const [created, setCreated] = useState<CategoryChoice[]>([]);
  const all = [...categories, ...created];
  const byId = new Map(all.map((category) => [category.id, category]));

  const current = currentId ? byId.get(currentId) : undefined;
  const [parentId, setParentId] = useState(current?.parentId ?? current?.id ?? "");
  const [childId, setChildId] = useState(current?.parentId ? current.id : "");
  const [newName, setNewName] = useState("");
  const [creating, startCreating] = useTransition();

  // A subcategory whose parent isn't selectable is shown as a top-level choice.
  const isTopLevel = (category: CategoryChoice) =>
    !category.parentId || !byId.has(category.parentId);
  const parents = all.filter(isTopLevel);
  const parent = byId.get(parentId);
  const children = all.filter((category) => category.parentId === parentId && parentId);
  const label = (category: CategoryChoice) =>
    category.isActive
      ? category.shortName
      : format(f.inactiveCategory, { name: category.shortName });

  function addSubcategory() {
    const name = newName.trim();
    if (!name || !parent) return;
    startCreating(async () => {
      const result = await createSubcategory(parent.id, name);
      if (!result.ok) {
        toast.error(t.errors[result.error]);
        return;
      }
      setCreated((list) => [
        ...list,
        { id: result.id, shortName: result.name, isActive: true, parentId: parent.id },
      ]);
      setChildId(result.id);
      setNewName("");
      onChange();
      onSelect?.(result.id);
      toast.success(format(f.subcategoryCreated, { name: result.name, parent: parent.shortName }));
    });
  }

  return (
    <>
      <input
        type="hidden"
        name="categoryId"
        value={childId && childId !== NEW ? childId : parentId}
      />
      <Field id={`${idPrefix}-category`} label={f.category} error={error}>
        {(a11y) => (
          <Combobox
            {...a11y}
            dataField="categoryId"
            disabled={disabled}
            value={parentId}
            placeholder={f.categoryPlaceholder}
            onChange={(value) => {
              setParentId(value);
              setChildId("");
              onChange();
              onSelect?.(value);
            }}
            options={parents.map((category) => ({ value: category.id, label: label(category) }))}
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-subcategory`}
        label={f.subcategory}
        optional={t.common.optional}
        hint={parent ? format(f.subcategoryHint, { name: parent.shortName }) : f.subcategoryFirst}
      >
        {(a11y) => (
          <div className="grid gap-2">
            <Combobox
              {...a11y}
              disabled={disabled || !parent}
              value={childId}
              onChange={(value) => {
                setChildId(value);
                if (value !== NEW) onChange();
                onSelect?.(value && value !== NEW ? value : parentId);
              }}
              options={[
                {
                  value: "",
                  label: parent ? format(f.subcategoryNone, { name: parent.shortName }) : "—",
                },
                ...children.map((category) => ({ value: category.id, label: label(category) })),
                { value: NEW, label: f.subcategoryNew },
              ]}
            />
            {childId === NEW && parent && (
              <div className="flex gap-2">
                <Input
                  aria-label={f.subcategoryName}
                  placeholder={f.subcategoryPlaceholder}
                  value={newName}
                  maxLength={NAME_MAX_LENGTH}
                  disabled={creating}
                  autoFocus
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds the subcategory instead of submitting the product.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addSubcategory();
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-auto"
                  disabled={creating || !newName.trim()}
                  onClick={addSubcategory}
                >
                  <Plus aria-hidden />
                  {f.subcategoryAdd}
                </Button>
              </div>
            )}
          </div>
        )}
      </Field>
    </>
  );
}
