"use client";

import { useState, useTransition } from "react";
import { Field } from "@/components/ui/form";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { createTag } from "@/lib/catalogue/actions";
import type { ProductTaxonomy, TagOption } from "@/lib/catalogue/queries";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import type { CategoryChoice } from "./category-picker";

/**
 * "Also list in" (extra categories) and "Tags" for the product form. Both
 * submit repeated hidden inputs (categoryIds / tagIds); the server replaces
 * the product's assignments with them.
 *
 * The main category is chosen with CategoryPicker and is always included by
 * the server, so it isn't offered here. Inactive categories / tags can't be
 * newly added, but ones the product already has are shown and can stay.
 */
export function ProductTaxonomyFields({
  idPrefix,
  categories,
  tags,
  saved,
  mainCategoryId,
  disabled,
  categoryError,
  tagError,
  onChange,
}: {
  idPrefix: string;
  /** Every category (tree order, full labels). */
  categories: CategoryChoice[];
  tags: TagOption[];
  saved: ProductTaxonomy;
  mainCategoryId: string;
  disabled: boolean;
  categoryError?: string;
  tagError?: string;
  onChange: () => void;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const f = t.products.fields;
  const toast = useToast();
  const [categoryIds, setCategoryIds] = useState(saved.categoryIds);
  const [tagIds, setTagIds] = useState(saved.tagIds);
  const [createdTags, setCreatedTags] = useState<TagOption[]>([]);
  const [creating, startCreating] = useTransition();

  const savedCategories = new Set(saved.categoryIds);
  const categoryOptions = categories
    .filter((category) => category.isActive || savedCategories.has(category.id))
    .filter((category) => category.id !== mainCategoryId)
    .map((category) => {
      const label = category.name ?? category.shortName;
      return {
        value: category.id,
        label: category.isActive ? label : format(f.inactiveCategory, { name: label }),
        disabled: !category.isActive,
      };
    });
  // The main category is implied; never submit it twice.
  const extraIds = categoryIds.filter((id) => id !== mainCategoryId);

  const savedTags = new Set(saved.tagIds);
  const tagOptions = [...tags, ...createdTags]
    .filter((tag) => tag.isActive || savedTags.has(tag.id))
    .map((tag) => ({
      value: tag.id,
      label: tag.isActive ? tag.name : format(f.inactiveTag, { name: tag.name }),
      disabled: !tag.isActive,
    }));

  function addTag(name: string) {
    startCreating(async () => {
      const result = await createTag(name);
      if (!result.ok) {
        toast.error(t.errors[result.error]);
        return;
      }
      setCreatedTags((list) => [...list, { id: result.id, name: result.name, isActive: true }]);
      setTagIds((list) => [...list, result.id]);
      onChange();
      toast.success(format(f.tagCreated, { name: result.name }));
    });
  }

  return (
    <>
      <Field
        id={`${idPrefix}-extra-categories`}
        label={f.extraCategories}
        optional={t.common.optional}
        hint={f.extraCategoriesHint}
        error={categoryError}
      >
        {(a11y) => (
          <MultiSelect
            {...a11y}
            name="categoryIds"
            dataField="categoryIds"
            disabled={disabled}
            placeholder={f.extraCategoriesPlaceholder}
            options={categoryOptions}
            value={extraIds}
            onChange={(next) => {
              setCategoryIds(next);
              onChange();
            }}
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-tags`}
        label={f.tags}
        optional={t.common.optional}
        hint={f.tagsHint}
        error={tagError}
      >
        {(a11y) => (
          <MultiSelect
            {...a11y}
            name="tagIds"
            dataField="tagIds"
            disabled={disabled}
            placeholder={f.tagsPlaceholder}
            options={tagOptions}
            value={tagIds}
            onChange={(next) => {
              setTagIds(next);
              onChange();
            }}
            onCreate={addTag}
            createLabel={(name) => format(f.tagCreate, { name })}
            creating={creating}
          />
        )}
      </Field>
    </>
  );
}
