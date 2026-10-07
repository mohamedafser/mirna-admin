"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle, Lock, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useActionState, useId, useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import type { Locale } from "@/config/i18n";
import { signIn, type SignInState } from "@/lib/auth/actions";
import { REDIRECT_PARAM } from "@/lib/auth/redirect";
import {
  hasErrors,
  normalizeEmail,
  validateLogin,
  type LoginFieldErrors,
} from "@/lib/auth/validation";
import { useI18n } from "@/lib/i18n/client";

const initialState: SignInState = { error: null, fieldErrors: {}, email: "" };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-error">
      {message}
    </p>
  );
}

/**
 * Email + password sign-in.
 * - Validates on the client for instant feedback; the Server Action validates
 *   again (never trust the client).
 * - One request at a time: the button is disabled while pending and extra
 *   submits (Enter key, double click) are ignored.
 */
export function LoginForm({ locale }: { locale: Locale }) {
  const { messages } = useI18n();
  const t = messages.auth;
  const redirectTo = useSearchParams().get(REDIRECT_PARAM) ?? "";
  const [state, action, pending] = useActionState(signIn, initialState);
  const [clientErrors, setClientErrors] = useState<LoginFieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const ids = { form: useId(), email: useId(), password: useId() };

  const fieldErrors = hasErrors(clientErrors) ? clientErrors : state.fieldErrors;
  const formError = state.error;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    const data = new FormData(event.currentTarget);
    const errors = validateLogin(
      normalizeEmail(data.get("email")),
      String(data.get("password") ?? ""),
    );
    setClientErrors(errors);
    if (hasErrors(errors)) {
      event.preventDefault();
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
  }

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name={REDIRECT_PARAM} value={redirectTo} />

      {formError && !pending && <Alert id={ids.form}>{t.errors[formError]}</Alert>}

      <div className="grid gap-2">
        <Label htmlFor="email">{t.email}</Label>
        <Input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          icon={Mail}
          placeholder={t.placeholders.email}
          autoComplete="username"
          inputMode="email"
          dir="ltr"
          required
          maxLength={254}
          defaultValue={state.email}
          aria-invalid={fieldErrors.email || formError ? true : undefined}
          aria-describedby={fieldErrors.email ? ids.email : formError ? ids.form : undefined}
        />
        <FieldError id={ids.email} message={fieldErrors.email && t.errors[fieldErrors.email]} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">{t.password}</Label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          icon={Lock}
          placeholder={t.placeholders.password}
          autoComplete="current-password"
          dir="ltr"
          required
          maxLength={256}
          aria-invalid={fieldErrors.password || formError ? true : undefined}
          aria-describedby={fieldErrors.password ? ids.password : formError ? ids.form : undefined}
          trailing={
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-9"
              aria-label={showPassword ? t.hidePassword : t.showPassword}
              aria-pressed={showPassword}
              title={showPassword ? t.hidePassword : t.showPassword}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          }
        />
        <FieldError
          id={ids.password}
          message={fieldErrors.password && t.errors[fieldErrors.password]}
        />
      </div>

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
            {t.signingIn}
          </>
        ) : (
          <>
            {t.signIn}
            {/* Forward arrow follows the reading direction. */}
            <ArrowRight aria-hidden className="rtl:-scale-x-100" />
          </>
        )}
      </Button>
    </form>
  );
}
