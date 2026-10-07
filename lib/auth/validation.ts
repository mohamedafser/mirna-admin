// Login input validation, shared by the client form (instant feedback) and
// the Server Action (authoritative).

export type EmailError = "emailRequired" | "emailInvalid";
export type PasswordError = "passwordRequired";

export interface LoginFieldErrors {
  email?: EmailError;
  password?: PasswordError;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function validateLogin(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  if (!email) errors.email = "emailRequired";
  else if (email.length > 254 || !EMAIL_PATTERN.test(email)) errors.email = "emailInvalid";
  if (!password) errors.password = "passwordRequired";
  return errors;
}

export function hasErrors(errors: LoginFieldErrors): boolean {
  return Boolean(errors.email || errors.password);
}

// New-account rules (first-admin setup and "Add administrator"). Supabase Auth
// hashes with bcrypt, which ignores bytes after 72, so longer passwords are
// rejected rather than silently truncated.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const NAME_MAX_LENGTH = 200;

export type NewAccountFieldError =
  | EmailError
  | "nameRequired"
  | "nameTooLong"
  | "passwordRequired"
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordMismatch"
  | "setupTokenRequired"
  | "setupTokenInvalid";

export interface NewAccountInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  /** Only for first-admin setup; undefined when the form has no such field. */
  setupToken?: string;
}

export type NewAccountFieldErrors = Partial<Record<keyof NewAccountInput, NewAccountFieldError>>;

export function readNewAccount(data: FormData): NewAccountInput {
  const setupToken = data.get("setupToken");
  return {
    fullName: String(data.get("fullName") ?? "").trim(),
    email: normalizeEmail(data.get("email")),
    password: String(data.get("password") ?? ""),
    confirmPassword: String(data.get("confirmPassword") ?? ""),
    setupToken: setupToken === null ? undefined : String(setupToken).trim(),
  };
}

export function validateNewAccount(input: NewAccountInput): NewAccountFieldErrors {
  const errors: NewAccountFieldErrors = {};
  const { email, password } = input;

  if (input.setupToken !== undefined && !input.setupToken) {
    errors.setupToken = "setupTokenRequired";
  }

  if (!input.fullName) errors.fullName = "nameRequired";
  else if (input.fullName.length > NAME_MAX_LENGTH) errors.fullName = "nameTooLong";

  const emailError = validateLogin(email, "x").email;
  if (emailError) errors.email = emailError;

  if (!password) errors.password = "passwordRequired";
  else if (password.length < PASSWORD_MIN_LENGTH) errors.password = "passwordTooShort";
  else if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    errors.password = "passwordTooLong";
  }

  if (!errors.password && input.confirmPassword !== password) {
    errors.confirmPassword = "passwordMismatch";
  }

  return errors;
}
