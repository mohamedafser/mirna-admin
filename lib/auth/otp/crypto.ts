import { createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Generating and hashing one-time codes. Pure, so it can be tested without a
 * server. Everything stored is an HMAC keyed from AUTH_OTP_SECRET: six digits
 * are only a million possibilities, so a plain hash would be trivially reversed
 * by anyone who could read the table.
 */

/** Six digits, leading zeros included, from a cryptographic source. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** A reset token: enough entropy that, unlike a code, it can't be guessed. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

function keyedHash(secret: string, label: string, value: string): string {
  // Its own key, so these hashes can't be derived from the API's bearer secret alone.
  const key = createHmac("sha256", secret).update("mirna-auth-otp-v1").digest();
  return createHmac("sha256", key).update(`${label}\0${value}`).digest("hex");
}

/** Tied to the email and purpose: a code means nothing for any other request. */
export function hashCode(secret: string, purpose: string, email: string, code: string): string {
  return keyedHash(secret, "code", `${purpose}\0${email}\0${code}`);
}

export function hashBinding(secret: string, binding: string): string {
  return keyedHash(secret, "binding", binding);
}

export function hashResetToken(secret: string, token: string): string {
  return keyedHash(secret, "reset", token);
}

export function hashIp(secret: string, ip: string): string {
  return keyedHash(secret, "ip", ip);
}
