"use client";

import { LoaderCircle, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveCategory, type CategoryFormResult } from "@/lib/catalogue/actions";
import { validateImageFile } from "@/lib/catalogue/images";
import { slugify } from "@/lib/catalogue/slug";
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  readCategory,
  validateCategory,
  type CatalogueFieldError,
  type CategoryFieldErrors,
} from "@/lib/catalogue/validation";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { CatalogueImage } from "./catalogue-image";
import { ImageDropzone } from "./image-dropzone";
import { useUnsavedChanges } from "./use-unsaved-changes";

export interface EditableCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

/** "Create category" / "Edit" button that opens the category form in a dialog. */
export function CategoryDialog({
  category,
  compact = false,
}: {
  category?: EditableCategory;
  /** Icon-only edit button (tables, cards). */
  compact?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue.categories;
  const [open, setOpen] = useState(false);
  // Remount the form on every open so it always starts from the latest data.
  const [session, setSession] = useState(0);

  return (
    <>
      {category ? (
        <Button
          variant="outline"
          size={compact ? "icon-sm" : "sm"}
          aria-label={format(t.editNamed, { name: category.name })}
          title={compact ? messages.catalogue.common.edit : undefined}
          onClick={() => {
            setSession((value) => value + 1);
            setOpen(true);
          }}
        >
          <Pencil aria-hidden />
          {!compact && <span aria-hidden>{messages.catalogue.common.edit}</span>}
        </Button>
      ) : (
        <Button
          onClick={() => {
            setSession((value) => value + 1);
            setOpen(true);
          }}
        >
          <Plus aria-hidden />
          {t.create}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={category ? t.edit : t.create}
        className="sm:max-w-2xl"
      >
        <CategoryForm key={session} category={category} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

const initialState: CategoryFormResult = { status: "idle", fieldErrors: {}, at: 0 };

function CategoryForm({ category, onDone }: { category?: EditableCategory; onDone: () => void }) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const toast = useToast();
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const [clientErrors, setClientErrors] = useState<CategoryFieldErrors | null>(null);
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  // An existing slug, or one the admin typed, is never overwritten by the name.
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const [image, setImage] = useState<File | null>(null);
  // Object URL for the chosen file; created/revoked in event handlers.
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [dirty, setDirty] = useState(false);
  const id = useId();
  useUnsavedChanges(dirty);

  function choosePreview(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
    setImage(file);
  }

  const fieldErrors = clientErrors ?? state.fieldErrors;
  const errorText = (code?: CatalogueFieldError) =>
    code === "slugTaken" ? t.categories.slugTaken : code && t.errors[code];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    if (image) data.set("image", image);
    if (removeImage) data.set("removeImage", "on");

    const errors = validateCategory(readCategory(data));
    const imageError = image ? validateImageFile(image) : null;
    if (imageError) errors.image = imageError;
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      const first = Object.keys(errors)[0];
      event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setClientErrors(null);
    startTransition(async () => {
      const result = await saveCategory(state, data);
      setState(result);
      if (result.status !== "success") return;
      setDirty(false);
      toast.success(result.mode === "created" ? t.categories.created : t.categories.updated);
      if (result.warning) toast.warning(t.errors[result.warning]);
      onDone();
    });
  }

  const currentImage = removeImage ? null : (preview ?? category?.image_url ?? null);
  const f = t.categories.fields;

  return (
    <form onSubmit={onSubmit} onChange={() => setDirty(true)} noValidate className="grid gap-5">
      <input type="hidden" name="id" value={category?.id ?? ""} readOnly />
      <input type="hidden" name="updatedAt" value={category?.updated_at ?? ""} readOnly />

      {state.error && !pending && <Alert>{t.errors[state.error]}</Alert>}

      <fieldset className="grid gap-4" disabled={pending}>
        <legend className="mb-1 text-sm font-semibold">{t.categories.sections.basic}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-name`} label={f.name} error={errorText(fieldErrors.name)}>
            {(a11y) => (
              <Input
                {...a11y}
                name="name"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                required
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
            hint={category && slug !== category.slug ? f.slugEditWarning : f.slugHint}
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
                onChange={(event) => {
                  setSlug(event.target.value);
                  setSlugTouched(event.target.value !== "");
                }}
              />
            )}
          </Field>
        </div>
        <Field
          id={`${id}-description`}
          label={f.description}
          optional={t.common.optional}
          error={errorText(fieldErrors.description)}
        >
          {(a11y) => (
            <Textarea
              {...a11y}
              name="description"
              rows={3}
              maxLength={CATEGORY_DESCRIPTION_MAX_LENGTH}
              defaultValue={category?.description ?? ""}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-3" disabled={pending}>
        <legend className="mb-1 text-sm font-semibold">{t.categories.sections.image}</legend>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <CatalogueImage
            src={currentImage}
            alt={currentImage ? format(t.categories.imageAlt, { name: name || slug }) : ""}
            sizes="96px"
            className="size-24"
          />
          <div className="grid min-w-0 flex-1 gap-2">
            <ImageDropzone
              disabled={pending}
              prompt={messages.catalogue.images.dropzone}
              browseLabel={category?.image_url || image ? f.replaceImage : f.chooseImage}
              activeLabel={messages.catalogue.images.dropActive}
              hint={f.imageHint}
              onFiles={([file]) => {
                choosePreview(file);
                setRemoveImage(false);
                setDirty(true);
                setClientErrors((errors) => ({
                  ...errors,
                  image: validateImageFile(file) ?? undefined,
                }));
              }}
            />
            {fieldErrors.image && (
              <p role="alert" className="text-sm text-error">
                {errorText(fieldErrors.image)}
              </p>
            )}
            {(image || category?.image_url) && (
              <div className="flex flex-wrap items-center gap-2">
                {image && (
                  <span className="truncate text-xs text-muted-foreground">{image.name}</span>
                )}
                {removeImage ? (
                  <>
                    <span className="text-xs text-muted-foreground">{f.imageRemoved}</span>
                    <Button variant="ghost" size="sm" onClick={() => setRemoveImage(false)}>
                      <Undo2 aria-hidden />
                      {f.undoRemove}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error hover:text-error"
                    onClick={() => {
                      if (image) choosePreview(null);
                      else setRemoveImage(true);
                      setDirty(true);
                    }}
                  >
                    <Trash2 aria-hidden />
                    {f.removeImage}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={pending}>
        <legend className="mb-1 text-sm font-semibold">{t.categories.sections.display}</legend>
        <Field
          id={`${id}-sort`}
          label={f.sortOrder}
          hint={f.sortOrderHint}
          error={errorText(fieldErrors.sortOrder)}
        >
          {(a11y) => (
            <Input
              {...a11y}
              name="sortOrder"
              inputMode="numeric"
              dir="ltr"
              defaultValue={category?.sort_order ?? 0}
            />
          )}
        </Field>
        <label className="flex items-start gap-3 self-center rounded-xl border p-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={category?.is_active ?? true}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="block font-medium">{f.active}</span>
            <span className="block text-xs text-muted-foreground">{f.activeHint}</span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={pending} onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle aria-hidden className="animate-spin" />}
          {pending ? t.common.saving : category ? t.common.saveChanges : t.categories.create}
        </Button>
      </div>
    </form>
  );
}
