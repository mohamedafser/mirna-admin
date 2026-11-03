import type { Locale } from "@/config/i18n";
import { COLORS, escapeHtml as e, SANS, SERIF } from "../../notifications/order-email.ts";

/**
 * The email carrying a one-time code: subject, responsive HTML and plain text,
 * in the same look as the order emails. The code stays out of the subject and
 * the preview text, so it doesn't show on a locked phone.
 */

export type OtpPurpose = "signup" | "recovery";

export interface OtpEmailData {
  locale: Locale;
  purpose: OtpPurpose;
  storeName: string;
  code: string;
}

interface Copy {
  subject: string;
  heading: string;
  body: string;
  codeLabel: string;
  expiry: string;
  ignore: string;
  neverShare: string;
}

const COPY: Record<Locale, Record<OtpPurpose, Copy>> = {
  en: {
    signup: {
      subject: "Verify your email for {store}",
      heading: "Verify your email",
      body: "Welcome to {store}. Enter this code to activate your account.",
      codeLabel: "Your verification code",
      expiry: "This code expires in 5 minutes and can be used once.",
      ignore: "If you didn't create an account, you can safely ignore this email.",
      neverShare: "{store} will never ask you for this code. Don't share it with anyone.",
    },
    recovery: {
      subject: "Reset your {store} password",
      heading: "Reset your password",
      body: "Enter this code to choose a new password for your {store} account.",
      codeLabel: "Your password reset code",
      expiry: "This code expires in 5 minutes and can be used once.",
      ignore:
        "If you didn't ask to reset your password, you can safely ignore this email. Your password won't change.",
      neverShare: "{store} will never ask you for this code. Don't share it with anyone.",
    },
  },
  ar: {
    signup: {
      subject: "تأكيد بريدك الإلكتروني لدى {store}",
      heading: "تأكيد بريدك الإلكتروني",
      body: "مرحبًا بك في {store}. أدخل هذا الرمز لتفعيل حسابك.",
      codeLabel: "رمز التحقق الخاص بك",
      expiry: "تنتهي صلاحية هذا الرمز خلال 5 دقائق ويمكن استخدامه مرة واحدة.",
      ignore: "إذا لم تنشئ حسابًا، يمكنك تجاهل هذه الرسالة بأمان.",
      neverShare: "لن يطلب منك {store} هذا الرمز أبدًا. لا تشاركه مع أي شخص.",
    },
    recovery: {
      subject: "إعادة تعيين كلمة مرورك لدى {store}",
      heading: "إعادة تعيين كلمة المرور",
      body: "أدخل هذا الرمز لاختيار كلمة مرور جديدة لحسابك لدى {store}.",
      codeLabel: "رمز إعادة تعيين كلمة المرور",
      expiry: "تنتهي صلاحية هذا الرمز خلال 5 دقائق ويمكن استخدامه مرة واحدة.",
      ignore:
        "إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان. لن تتغير كلمة مرورك.",
      neverShare: "لن يطلب منك {store} هذا الرمز أبدًا. لا تشاركه مع أي شخص.",
    },
  },
};

export function renderOtpEmail(data: OtpEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const rtl = data.locale === "ar";
  const start = rtl ? "right" : "left";
  const fill = (template: string) => template.replace("{store}", data.storeName);
  const copy = COPY[data.locale][data.purpose];
  const subject = fill(copy.subject);
  const body = fill(copy.body);
  const neverShare = fill(copy.neverShare);

  const html = `<!doctype html>
<html lang="${data.locale}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(subject)}</title>
<style>
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  table { border-collapse: collapse; }
  @media only screen and (max-width: 620px) {
    .outer { padding: 0 !important; }
    .container { width: 100% !important; border-left: 0 !important; border-right: 0 !important; }
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
    .heading { font-size: 24px !important; }
    .code { font-size: 30px !important; letter-spacing: .2em !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${COLORS.page};font-size:1px;line-height:1px;">${e(copy.expiry)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.page};">
<tr><td class="outer" align="center" style="padding:32px 12px;">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${COLORS.card};border:1px solid ${COLORS.border};">
    <tr><td class="pad" align="center" bgcolor="${COLORS.brand}" style="background-color:${COLORS.brand};padding:26px 36px;font-family:${SERIF};font-size:18px;font-weight:400;letter-spacing:${rtl ? "0" : ".32em"};${rtl ? "" : "text-transform:uppercase;"}color:${COLORS.brandText};">${e(data.storeName)}</td></tr>
    <tr><td class="pad" style="padding:36px 36px 0;text-align:${start};">
      <h1 class="heading" style="margin:0 0 16px;font-family:${SERIF};font-size:28px;line-height:1.25;font-weight:400;color:${COLORS.text};">${e(copy.heading)}</h1>
      <p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.6;color:${COLORS.muted};">${e(body)}</p>
    </td></tr>
    <tr><td class="pad" style="padding:28px 36px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.subtle}" style="background-color:${COLORS.subtle};"><tr>
        <td align="center" style="padding:24px 16px;font-family:${SANS};">
          <div style="font-size:11px;letter-spacing:${rtl ? "0" : ".08em"};${rtl ? "" : "text-transform:uppercase;"}color:${COLORS.muted};padding-bottom:10px;">${e(copy.codeLabel)}</div>
          <div class="code" dir="ltr" style="font-family:'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:36px;line-height:1.2;font-weight:700;letter-spacing:.3em;margin-right:-.3em;color:${COLORS.text};">${e(data.code)}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="pad" style="padding:20px 36px 0;text-align:${start};">
      <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.6;font-weight:600;color:${COLORS.text};">${e(copy.expiry)}</p>
    </td></tr>
    <tr><td class="pad" style="padding:28px 36px 36px;font-family:${SANS};font-size:12px;line-height:1.6;color:${COLORS.muted};text-align:${start};">
      <div style="padding-bottom:8px;">${e(copy.ignore)}</div>
      <div>${e(neverShare)}</div>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    data.storeName,
    "",
    copy.heading,
    "",
    body,
    "",
    `${copy.codeLabel}: ${data.code}`,
    copy.expiry,
    "",
    copy.ignore,
    neverShare,
  ].join("\n");

  return { subject, html, text };
}
