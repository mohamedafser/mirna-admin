import { NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { normalizePhone, PHONE_MAX_LENGTH } from "@/lib/settings/rules";

/**
 * Profile rules, shared by the forms (instant feedback) and the Server
 * Actions (authoritative). Limits match the profiles CHECK constraints
 * (full_name ≤ 200, phone ≤ 32) and Supabase Auth's bcrypt (≤ 72 bytes).
 */

export { NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PHONE_MAX_LENGTH };

const PHONE_PATTERN = /^\+?[0-9 ()-]{6,32}$/;

export type ProfileFieldError = "nameRequired" | "nameTooLong" | "phoneInvalid";

export interface ProfileInput {
  fullName: string;
  /** "" = no phone. */
  phone: string;
}

export type ProfileFieldErrors = Partial<Record<keyof ProfileInput, ProfileFieldError>>;

export function readProfile(data: FormData): ProfileInput {
  return {
    fullName: String(data.get("fullName") ?? "")
      .trim()
      .replace(/\s+/g, " "),
    // Arabic-Indic digits typed on an Arabic keyboard become ASCII.
    phone: normalizePhone(String(data.get("phone") ?? "").trim()),
  };
}

export function validateProfile(input: ProfileInput): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  if (!input.fullName) errors.fullName = "nameRequired";
  else if (input.fullName.length > NAME_MAX_LENGTH) errors.fullName = "nameTooLong";
  if (input.phone && !PHONE_PATTERN.test(input.phone)) errors.phone = "phoneInvalid";
  return errors;
}

export type PasswordFieldError =
  | "currentRequired"
  | "currentWrong"
  | "passwordRequired"
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordSame"
  | "passwordWeak"
  | "passwordMismatch";

export interface PasswordInput {
  currentPassword: string;
  password: string;
  confirmPassword: string;
}

export type PasswordFieldErrors = Partial<Record<keyof PasswordInput, PasswordFieldError>>;

export function readPassword(data: FormData): PasswordInput {
  return {
    currentPassword: String(data.get("currentPassword") ?? ""),
    password: String(data.get("password") ?? ""),
    confirmPassword: String(data.get("confirmPassword") ?? ""),
  };
}

export function validatePassword(input: PasswordInput): PasswordFieldErrors {
  const errors: PasswordFieldErrors = {};
  const { password } = input;
  if (!input.currentPassword) errors.currentPassword = "currentRequired";

  if (!password) errors.password = "passwordRequired";
  else if (password.length < PASSWORD_MIN_LENGTH) errors.password = "passwordTooShort";
  else if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    errors.password = "passwordTooLong";
  } else if (password === input.currentPassword) errors.password = "passwordSame";

  if (!errors.password && input.confirmPassword !== password) {
    errors.confirmPassword = "passwordMismatch";
  }
  return errors;
}
