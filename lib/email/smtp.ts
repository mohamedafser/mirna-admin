import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email over SMTP. Works with any provider; everything comes from
 * server-only environment variables (never NEXT_PUBLIC_*), and the password is
 * only ever handed to the transport.
 */

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim() ?? "";
  return {
    host: process.env.SMTP_HOST?.trim() ?? "",
    port,
    // 465 = implicit TLS; other ports (587/25) upgrade with STARTTLS.
    secure: port === 465,
    user,
    pass: process.env.SMTP_PASSWORD ?? "",
    fromEmail: process.env.SMTP_FROM_EMAIL?.trim() || user,
    fromName: process.env.SMTP_FROM_NAME?.trim() || "Mirna",
  };
}

export function isSmtpConfigured(): boolean {
  const { host, port, user, pass, fromEmail } = smtpConfig();
  return Boolean(host && Number.isInteger(port) && port > 0 && user && pass && fromEmail);
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const { host, port, secure, user, pass } = smtpConfig();
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // A slow or unreachable server fails fast and is retried later.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Stable id for this email, used for its Message-ID, so a rare re-send of the
   * same email is recognisable as a duplicate by mail servers.
   */
  id: string;
}

/** Sends one email. Throws on failure; the caller decides whether to retry. */
export async function sendEmail({ id, ...message }: EmailMessage): Promise<void> {
  const { fromEmail, fromName } = smtpConfig();
  await getTransporter().sendMail({
    ...message,
    from: { name: fromName, address: fromEmail },
    messageId: `<${id}@${fromEmail.split("@")[1] ?? "localhost"}>`,
    headers: { "Auto-Submitted": "auto-generated" },
  });
}
