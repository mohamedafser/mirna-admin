import { timingSafeEqual } from "node:crypto";
import { isLocale } from "@/config/i18n";
import { resetPassword, otpContext, requestOtp, verifyOtp } from "@/lib/auth/otp/service";
import { describeError } from "@/lib/notifications/rules";

/**
 * Server-to-server: the storefront's Server Actions run its email code flows
 * here, because this app holds the SMTP settings and the service role key.
 * Never called from a browser, and answers go back to the storefront's server.
 *
 *   POST /api/auth/otp
 *   Authorization: Bearer $AUTH_OTP_SECRET
 *   { "action": "request" | "verify" | "reset", … }
 *
 * The answers never say whether an email has an account (lib/auth/otp/service.ts).
 */

function authorized(request: Request): boolean {
  const secret = process.env.AUTH_OTP_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const invalid = () => json({ error: "invalid_body" }, 400);

const isString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const isEmail = (value: unknown): value is string =>
  isString(value, 254) &&
  value === value.trim().toLowerCase() &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isPurpose = (value: unknown): value is "signup" | "recovery" =>
  value === "signup" || value === "recovery";

const isToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);

/** bcrypt only reads the first 72 bytes, so longer isn't accepted. */
const isPassword = (value: unknown): value is string =>
  isString(value, 72) && value.length >= 8 && Buffer.byteLength(value) <= 72;

export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const ctx = otpContext();
  if (!ctx) return json({ error: "not_configured" }, 503);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) return invalid();
    body = parsed as Record<string, unknown>;
  } catch {
    return invalid();
  }

  try {
    switch (body.action) {
      case "request": {
        const { purpose, email, locale, binding, ip, resend, password, fullName } = body;
        if (!isPurpose(purpose) || !isEmail(email) || !isLocale(locale) || !isToken(binding)) {
          return invalid();
        }
        if (password != null && !isPassword(password)) return invalid();
        if (fullName != null && !isString(fullName, 200)) return invalid();
        if (password != null && (purpose !== "signup" || resend === true)) return invalid();
        return json(
          await requestOtp(ctx, {
            purpose,
            email,
            locale,
            binding,
            ip: isString(ip, 64) ? ip : null,
            resend: resend === true,
            password: password ?? null,
            fullName: fullName ?? null,
          }),
        );
      }
      case "verify": {
        const { purpose, email, code, binding } = body;
        if (!isPurpose(purpose) || !isEmail(email) || !isToken(binding)) return invalid();
        if (typeof code !== "string" || !/^\d{6}$/.test(code)) return invalid();
        return json(await verifyOtp(ctx, { purpose, email, code, binding }));
      }
      case "reset": {
        const { resetToken, password } = body;
        if (!isToken(resetToken) || !isPassword(password)) return invalid();
        return json(await resetPassword(ctx, { resetToken, password }));
      }
      default:
        return invalid();
    }
  } catch (error) {
    console.error(`[auth-otp] ${String(body.action)} failed: ${describeError(error)}`);
    return json({ error: "failed" }, 502);
  }
}
