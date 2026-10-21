"use client";

import { Eye, EyeOff, LoaderCircle, Lock, Mail, Phone, Save, UserRound } from "lucide-react";
import { useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import {
  changePassword,
  updateProfile,
  type PasswordFormState,
  type ProfileFormState,
} from "@/lib/profile/actions";
import {
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  readPassword,
  readProfile,
  validatePassword,
  validateProfile,
  type PasswordFieldErrors,
  type ProfileFieldErrors,
} from "@/lib/profile/rules";
import { useI18n } from "@/lib/i18n/client";

const initialProfile: ProfileFormState = { status: "idle", fieldErrors: {}, at: 0 };
const initialPassword: PasswordFormState = { status: "idle", fieldErrors: {}, at: 0 };

/** Focuses the first invalid control of a form. */
function focusFirstInvalid(form: HTMLFormElement, names: string[]) {
  for (const name of names) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLInputElement) {
      control.focus();
      return;
    }
  }
}

function SubmitButton({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className="justify-self-start">
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Name and phone. Validated on the client for instant feedback; the Server
 * Action validates again. The email is shown read-only (it is the sign-in).
 */
export function ProfileDetailsForm({
  fullName,
  phone,
  email,
}: {
  fullName: string;
  phone: string;
  email: string;
}) {
  const { messages } = useI18n();
  const t = messages.profile;
  const toast = useToast();
  const id = useId();
  const [state, action, pending] = useActionState(updateProfile, initialProfile);
  const [clientErrors, setClientErrors] = useState<ProfileFieldErrors | null>(null);
  const errors = clientErrors ?? state.fieldErrors;
  const values = state.values ?? { fullName, phone };

  useEffect(() => {
    if (state.status === "success") toast.success(t.details.saved);
    // Once per submit result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const found = validateProfile(readProfile(new FormData(event.currentTarget)));
    const invalid = Object.keys(found);
    setClientErrors(invalid.length > 0 ? found : null);
    if (invalid.length > 0) {
      event.preventDefault();
      focusFirstInvalid(event.currentTarget, invalid);
    }
  }

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="grid gap-4">
      {state.error && !pending && <Alert>{t.errors[state.error]}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${id}-name`}
          label={t.details.fullName}
          error={errors.fullName && t.errors[errors.fullName]}
        >
          {(a11y) => (
            <Input
              {...a11y}
              name="fullName"
              icon={UserRound}
              autoComplete="name"
              maxLength={NAME_MAX_LENGTH}
              defaultValue={values.fullName}
              key={`name-${state.at}`}
              required
            />
          )}
        </Field>
        <Field
          id={`${id}-phone`}
          label={t.details.phone}
          optional={t.details.optional}
          error={errors.phone && t.errors[errors.phone]}
        >
          {(a11y) => (
            <Input
              {...a11y}
              name="phone"
              type="tel"
              icon={Phone}
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              maxLength={PHONE_MAX_LENGTH}
              placeholder={t.details.phonePlaceholder}
              defaultValue={values.phone}
              key={`phone-${state.at}`}
            />
          )}
        </Field>
        <Field
          id={`${id}-email`}
          label={t.details.email}
          hint={t.details.emailHint}
          className="sm:col-span-2"
        >
          {(a11y) => (
            <Input {...a11y} type="email" icon={Mail} dir="ltr" value={email} readOnly disabled />
          )}
        </Field>
      </div>
      <SubmitButton pending={pending} label={t.details.save} pendingLabel={t.details.saving} />
    </form>
  );
}

/** Current + new password. The form is cleared after a successful change. */
export function PasswordForm({ email }: { email: string }) {
  const { messages } = useI18n();
  const t = messages.profile;
  const toast = useToast();
  const id = useId();
  const [state, action, pending] = useActionState(changePassword, initialPassword);
  const [clientErrors, setClientErrors] = useState<PasswordFieldErrors | null>(null);
  const [show, setShow] = useState(false);
  const errors = clientErrors ?? state.fieldErrors;

  useEffect(() => {
    if (state.status === "success") toast.success(t.password.saved);
    // Once per submit result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const found = validatePassword(readPassword(new FormData(event.currentTarget)));
    const invalid = Object.keys(found);
    setClientErrors(invalid.length > 0 ? found : null);
    if (invalid.length > 0) {
      event.preventDefault();
      focusFirstInvalid(event.currentTarget, invalid);
    }
  }

  const toggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-9"
      aria-label={show ? messages.auth.hidePassword : messages.auth.showPassword}
      aria-pressed={show}
      title={show ? messages.auth.hidePassword : messages.auth.showPassword}
      onClick={() => setShow((value) => !value)}
    >
      {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
    </Button>
  );
  const fields = [
    { name: "currentPassword", label: t.password.current, autoComplete: "current-password" },
    { name: "password", label: t.password.new, autoComplete: "new-password" },
    { name: "confirmPassword", label: t.password.confirm, autoComplete: "new-password" },
  ] as const;

  return (
    // A new key after success clears every field (passwords are never echoed back).
    <form
      key={state.status === "success" ? state.at : "form"}
      action={action}
      onSubmit={onSubmit}
      noValidate
      className="grid gap-4"
    >
      {state.error && !pending && <Alert>{t.errors[state.error]}</Alert>}
      {/* Lets password managers pair the new password with the account. */}
      <input type="hidden" name="username" autoComplete="username" value={email} />
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field, index) => {
          const error = errors[field.name];
          return (
            <Field
              key={field.name}
              id={`${id}-${field.name}`}
              label={field.label}
              error={error && t.errors[error]}
              className={index === 0 ? "sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]" : undefined}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  name={field.name}
                  type={show ? "text" : "password"}
                  icon={Lock}
                  dir="ltr"
                  autoComplete={field.autoComplete}
                  maxLength={field.name === "currentPassword" ? 256 : PASSWORD_MAX_LENGTH}
                  trailing={index === 0 ? toggle : undefined}
                  required
                />
              )}
            </Field>
          );
        })}
      </div>
      <SubmitButton pending={pending} label={t.password.save} pendingLabel={t.password.saving} />
    </form>
  );
}
