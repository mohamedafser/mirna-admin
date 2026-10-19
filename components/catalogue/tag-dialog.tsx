"use client";

import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveTag, type TagFormResult } from "@/lib/catalogue/actions";
import { slugify } from "@/lib/catalogue/slug";
import {
  readTag,
  TAG_NAME_MAX_LENGTH,
  TAG_SLUG_MAX_LENGTH,
  validateTag,
  type CatalogueFieldError,
  type TagFieldErrors,
} from "@/lib/catalogue/validation";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { useUnsavedChanges } from "./use-unsaved-changes";

export interface EditableTag {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  updated_at: string;
}

/** "Create tag" / "Edit" button that opens the tag form in a dialog. */
export function TagDialog({ tag, compact = false }: { tag?: EditableTag; compact?: boolean }) {
  const { messages } = useI18n();
  const t = messages.catalogue.tags;
  const [open, setOpen] = useState(false);
  // Remount the form on every open so it always starts from the latest data.
  const [session, setSession] = useState(0);
  const show = () => {
    setSession((value) => value + 1);
    setOpen(true);
  };

  return (
    <>
      {tag ? (
        <Button
          variant="outline"
          size={compact ? "icon-sm" : "sm"}
          aria-label={format(t.editNamed, { name: tag.name })}
          title={compact ? messages.catalogue.common.edit : undefined}
          onClick={show}
        >
          <Pencil aria-hidden />
          {!compact && <span aria-hidden>{messages.catalogue.common.edit}</span>}
        </Button>
      ) : (
        <Button onClick={show}>
          <Plus aria-hidden />
          {t.create}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={tag ? t.edit : t.create}>
        <TagForm key={session} tag={tag} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

const initialState: TagFormResult = { status: "idle", fieldErrors: {}, at: 0 };

function TagForm({ tag, onDone }: { tag?: EditableTag; onDone: () => void }) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const f = t.tags.fields;
  const toast = useToast();
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const [clientErrors, setClientErrors] = useState<TagFieldErrors | null>(null);
  const [name, setName] = useState(tag?.name ?? "");
  const [slug, setSlug] = useState(tag?.slug ?? "");
  // An existing slug, or one the admin typed, is never overwritten by the name.
  const [slugTouched, setSlugTouched] = useState(Boolean(tag));
  const [dirty, setDirty] = useState(false);
  const id = useId();
  useUnsavedChanges(dirty);

  const fieldErrors = clientErrors ?? state.fieldErrors;
  const errorText = (code?: CatalogueFieldError) =>
    code === "slugTaken" ? t.tags.slugTaken : code && t.errors[code];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const errors = validateTag(readTag(data));
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      const first = Object.keys(errors)[0];
      event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setClientErrors(null);
    startTransition(async () => {
      const result = await saveTag(state, data);
      setState(result);
      if (result.status !== "success") return;
      setDirty(false);
      toast.success(result.mode === "created" ? t.tags.created : t.tags.updated);
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} onChange={() => setDirty(true)} noValidate className="grid gap-5">
      <input type="hidden" name="id" value={tag?.id ?? ""} readOnly />
      <input type="hidden" name="updatedAt" value={tag?.updated_at ?? ""} readOnly />

      {state.error && !pending && <Alert>{t.errors[state.error]}</Alert>}

      <fieldset className="grid gap-4" disabled={pending}>
        <Field id={`${id}-name`} label={f.name} error={errorText(fieldErrors.name)}>
          {(a11y) => (
            <Input
              {...a11y}
              name="name"
              value={name}
              maxLength={TAG_NAME_MAX_LENGTH}
              required
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched)
                  setSlug(slugify(event.target.value).slice(0, TAG_SLUG_MAX_LENGTH));
              }}
            />
          )}
        </Field>
        <Field
          id={`${id}-slug`}
          label={f.slug}
          error={errorText(fieldErrors.slug)}
          hint={tag && slug !== tag.slug ? f.slugEditWarning : f.slugHint}
        >
          {(a11y) => (
            <Input
              {...a11y}
              name="slug"
              value={slug}
              dir="ltr"
              maxLength={TAG_SLUG_MAX_LENGTH}
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
        <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={tag?.is_active ?? true}
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
          {pending ? t.common.saving : tag ? t.common.saveChanges : t.tags.create}
        </Button>
      </div>
    </form>
  );
}
