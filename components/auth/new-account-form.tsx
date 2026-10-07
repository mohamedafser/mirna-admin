"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, Lock, Mail, UserPlus, UserRound } from "lucide-react";
import {
  useActionState,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import type { Locale } from "@/config/i18n";
import type { AccountFormState } from "@/lib/auth/account-actions";
import {
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  readNewAccount,
  validateNewAccount,
  type NewAccountFieldErrors,
  type NewAccountInput,
} from "@/lib/auth/validation";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";

const initialState: AccountFormState = {
  error: null,
  fieldErrors: {},
  values: { fullName: "", email: "" },
  createdEmail: null,
};

type Field = keyof NewAccountInput;

/**
 * Create-an-administrator form, shared by first-admin setup (with the setup
 * key field) and the Admins page. Validates on the client for instant
 * feedback; the Server Action validates again.
 */
export function NewAccountForm({
  action: serverAction,
  locale,
  withSetupToken = false,
  submitLabel,
}: {
  action: (state: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  locale: Locale;
  withSetupToken?: boolean;
  submitLabel: string;
}) {
  const { messages } = useI18n();
  const t = messages.accounts;
  const [state, action, pending] = useActionState(serverAction, initialState);
  const [clientErrors, setClientErrors] = useState<NewAccountFieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const refs = {
    setupToken: useRef<HTMLInputElement>(null),
    fullName: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmPassword: useRef<HTMLInputElement>(null),
  } satisfies Record<Field, unknown>;
  const formId = useId();
  const baseId = useId();

  const fieldErrors = Object.keys(clientErrors).length > 0 ? clientErrors : state.fieldErrors;
  const formError = state.error;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    const errors = validateNewAccount(readNewAccount(new FormData(event.currentTarget)));
    setClientErrors(errors);
    const firstInvalid = (Object.keys(refs) as Field[]).find((field) => errors[field]);
    if (firstInvalid) {
      event.preventDefault();
      refs[firstInvalid].current?.focus();
      return;
    }
  }

  function field(
    name: Field,
    label: string,
    props: ComponentProps<typeof Input>,
    hint?: string,
  ): ReactNode {
    const error = fieldErrors[name];
    const errorId = `${baseId}-${name}-error`;
    const hintId = `${baseId}-${name}-hint`;
    const describedBy = error ? errorId : hint ? hintId : formError ? formId : undefined;
    return (
      <div className="grid gap-2">
        <Label htmlFor={`${baseId}-${name}`}>{label}</Label>
        <Input
          ref={refs[name]}
          id={`${baseId}-${name}`}
          name={name}
          placeholder={t.placeholders[name]}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {error ? (
          <p id={errorId} className="text-sm text-error">
            {t.errors[error]}
          </p>
        ) : (
          hint && (
            <p id={hintId} className="text-xs text-muted-foreground">
              {hint}
            </p>
          )
        )}
      </div>
    );
  }

  const passwordToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-9"
      aria-label={showPassword ? messages.auth.hidePassword : messages.auth.showPassword}
      aria-pressed={showPassword}
      title={showPassword ? messages.auth.hidePassword : messages.auth.showPassword}
      onClick={() => setShowPassword((value) => !value)}
    >
      {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
    </Button>
  );

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />

      {formError && !pending && (
        <Alert id={formId}>
          {t.errors[formError]}
          {/* Development only: the technical cause (never sent in production). */}
          {process.env.NODE_ENV === "development" && state.detail && (
            <span className="mt-1 block font-mono text-xs break-all opacity-80" dir="ltr">
              {state.detail}
            </span>
          )}
        </Alert>
      )}
      {state.createdEmail && !pending && !formError && (
        <Alert tone="success">{format(t.created, { email: state.createdEmail })}</Alert>
      )}

      {withSetupToken &&
        field(
          "setupToken",
          t.setupToken,
          { type: "password", icon: KeyRound, autoComplete: "off", dir: "ltr", maxLength: 256 },
          t.setupTokenHint,
        )}

      {field("fullName", t.fullName, {
        type: "text",
        icon: UserRound,
        autoComplete: withSetupToken ? "name" : "off",
        maxLength: NAME_MAX_LENGTH,
        defaultValue: state.values.fullName,
      })}

      {field("email", t.email, {
        type: "email",
        icon: Mail,
        autoComplete: withSetupToken ? "username" : "off",
        inputMode: "email",
        dir: "ltr",
        maxLength: 254,
        defaultValue: state.values.email,
      })}

      {field(
        "password",
        t.password,
        {
          type: showPassword ? "text" : "password",
          icon: Lock,
          autoComplete: "new-password",
          dir: "ltr",
          maxLength: PASSWORD_MAX_LENGTH,
          trailing: passwordToggle,
        },
        t.passwordHint,
      )}

      {field("confirmPassword", t.confirmPassword, {
        type: showPassword ? "text" : "password",
        icon: Lock,
        autoComplete: "new-password",
        dir: "ltr",
        maxLength: PASSWORD_MAX_LENGTH,
      })}

      <Button
        type="submit"
        size="lg"
        disabled={pending}
        aria-busy={pending}
        className="mt-1 w-full"
      >
        {pending ? (
          <>
            <LoaderCircle aria-hidden className="animate-spin" />
            {t.creating}
          </>
        ) : (
          <>
            <UserPlus aria-hidden />
            {submitLabel}
          </>
        )}
      </Button>
    </form>
  );
}
