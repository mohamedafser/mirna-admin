import type { Locale } from "@/config/i18n";
import type { OrderStatus } from "@/types/domain";

/**
 * The order status email: subject, responsive HTML and plain text. Takes values
 * already formatted (money, dates), does no I/O, and escapes everything it
 * inserts into the HTML, since names and addresses are customer input.
 *
 * Email clients ignore most modern CSS, hence tables and inline styles. Colours
 * are the admin's light theme (app/globals.css), fixed so the brand looks the
 * same in every client.
 */

export interface OrderEmailItem {
  name: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  total: string;
}

export interface OrderEmailData {
  locale: Locale;
  status: OrderStatus;
  storeName: string;
  customerName: string | null;
  orderNumber: number;
  placedAt: string;
  /** The order is still waiting for its online payment. */
  awaitingPayment: boolean;
  items: OrderEmailItem[];
  subtotal: string;
  /** Null: nothing to show (no discount / no tax). */
  discount: string | null;
  tax: string | null;
  shipping: string;
  total: string;
  shippingMethod: "STANDARD" | "EXPRESS" | null;
  /** e.g. "3–5" (days); null when unknown. */
  deliveryDays: string | null;
  addressLines: string[];
  /** The order's page on the storefront; null hides the button. */
  orderUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

interface StatusCopy {
  label: string;
  subject: string;
  heading: string;
  body: string;
}

interface EmailCopy {
  statuses: Record<OrderStatus, StatusCopy>;
  greeting: string;
  greetingAnonymous: string;
  awaitingPayment: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  summary: string;
  quantity: string;
  sku: string;
  subtotal: string;
  discount: string;
  shipping: string;
  tax: string;
  total: string;
  deliverTo: string;
  deliveryMethod: string;
  methods: Record<"STANDARD" | "EXPRESS", string>;
  estimate: string;
  viewOrder: string;
  help: string;
  noReply: string;
}

const COPY: Record<Locale, EmailCopy> = {
  en: {
    statuses: {
      PENDING: {
        label: "Order placed",
        subject: "We've received your order #{number}",
        heading: "Thank you for your order",
        body: "We've received your order and will let you know as soon as it's confirmed.",
      },
      CONFIRMED: {
        label: "Confirmed",
        subject: "Your order #{number} is confirmed",
        heading: "Your order is confirmed",
        body: "Good news: your order is confirmed. We'll start preparing it shortly.",
      },
      PROCESSING: {
        label: "Processing",
        subject: "Your order #{number} is being prepared",
        heading: "We're preparing your order",
        body: "Your order is being prepared with care. We'll let you know when it's on its way.",
      },
      SHIPPED: {
        label: "Shipped",
        subject: "Your order #{number} is on its way",
        heading: "Your order is on its way",
        body: "Your order has left us and is on its way to you.",
      },
      DELIVERED: {
        label: "Delivered",
        subject: "Your order #{number} has been delivered",
        heading: "Your order has been delivered",
        body: "Your order has arrived. We hope you love it. Thank you for shopping with us.",
      },
      CANCELLED: {
        label: "Cancelled",
        subject: "Your order #{number} has been cancelled",
        heading: "Your order has been cancelled",
        body: "Your order has been cancelled. If you have any questions, please get in touch.",
      },
      REFUNDED: {
        label: "Refunded",
        subject: "Your order #{number} has been refunded",
        heading: "Your order has been refunded",
        body: "We've refunded your order to your original payment method. It can take a few business days to appear.",
      },
    },
    greeting: "Hello {name},",
    greetingAnonymous: "Hello,",
    awaitingPayment: "This order is waiting for your payment. It will be confirmed once paid.",
    orderNumber: "Order number",
    orderDate: "Order date",
    status: "Status",
    summary: "Order summary",
    quantity: "Qty",
    sku: "SKU",
    subtotal: "Subtotal",
    discount: "Discount",
    shipping: "Delivery",
    tax: "Tax",
    total: "Total",
    deliverTo: "Delivery address",
    deliveryMethod: "Delivery method",
    methods: { STANDARD: "Standard", EXPRESS: "Express" },
    estimate: "{days} day(s)",
    viewOrder: "View your order",
    help: "Need help with your order?",
    noReply: "You're receiving this email because you placed an order with {store}.",
  },
  ar: {
    statuses: {
      PENDING: {
        label: "تم استلام الطلب",
        subject: "استلمنا طلبك رقم {number}",
        heading: "شكرًا لطلبك",
        body: "استلمنا طلبك وسنعلمك فور تأكيده.",
      },
      CONFIRMED: {
        label: "مؤكد",
        subject: "تم تأكيد طلبك رقم {number}",
        heading: "تم تأكيد طلبك",
        body: "يسعدنا إبلاغك بتأكيد طلبك. سنبدأ في تجهيزه قريبًا.",
      },
      PROCESSING: {
        label: "قيد التجهيز",
        subject: "طلبك رقم {number} قيد التجهيز",
        heading: "نقوم بتجهيز طلبك",
        body: "يجري تجهيز طلبك بعناية، وسنعلمك عندما يصبح في الطريق إليك.",
      },
      SHIPPED: {
        label: "تم الشحن",
        subject: "طلبك رقم {number} في الطريق إليك",
        heading: "طلبك في الطريق إليك",
        body: "غادر طلبك مستودعنا وهو الآن في الطريق إليك.",
      },
      DELIVERED: {
        label: "تم التوصيل",
        subject: "تم توصيل طلبك رقم {number}",
        heading: "تم توصيل طلبك",
        body: "وصل طلبك. نتمنى أن ينال إعجابك، وشكرًا لتسوقك معنا.",
      },
      CANCELLED: {
        label: "ملغي",
        subject: "تم إلغاء طلبك رقم {number}",
        heading: "تم إلغاء طلبك",
        body: "تم إلغاء طلبك. إذا كانت لديك أي استفسارات، يرجى التواصل معنا.",
      },
      REFUNDED: {
        label: "تم الاسترداد",
        subject: "تم استرداد مبلغ طلبك رقم {number}",
        heading: "تم استرداد مبلغ طلبك",
        body: "أعدنا مبلغ طلبك إلى وسيلة الدفع الأصلية، وقد يستغرق ظهوره بضعة أيام عمل.",
      },
    },
    greeting: "مرحبًا {name}،",
    greetingAnonymous: "مرحبًا،",
    awaitingPayment: "هذا الطلب بانتظار الدفع، وسيتم تأكيده بعد إتمام الدفع.",
    orderNumber: "رقم الطلب",
    orderDate: "تاريخ الطلب",
    status: "الحالة",
    summary: "ملخص الطلب",
    quantity: "الكمية",
    sku: "رمز المنتج",
    subtotal: "المجموع الفرعي",
    discount: "الخصم",
    shipping: "التوصيل",
    tax: "الضريبة",
    total: "الإجمالي",
    deliverTo: "عنوان التوصيل",
    deliveryMethod: "طريقة التوصيل",
    methods: { STANDARD: "عادي", EXPRESS: "سريع" },
    estimate: "{days} يوم",
    viewOrder: "عرض طلبك",
    help: "هل تحتاج إلى مساعدة بخصوص طلبك؟",
    noReply: "وصلتك هذه الرسالة لأنك قدمت طلبًا لدى {store}.",
  },
};

export const COLORS = {
  page: "#faf7f3",
  card: "#ffffff",
  brand: "#291013",
  brandText: "#faf7f3",
  text: "#291113",
  muted: "#655754",
  soft: "#dbd2c7",
  subtle: "#f2ece5",
  border: "#e4dbd1",
};

export const SANS = "'Helvetica Neue',Helvetica,Arial,'Segoe UI',Tahoma,sans-serif";
export const SERIF = "Georgia,'Times New Roman',Tahoma,serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderOrderEmail(data: OrderEmailData): RenderedEmail {
  const copy = COPY[data.locale];
  const statusCopy = copy.statuses[data.status];
  const number = `#${data.orderNumber}`;
  const rtl = data.locale === "ar";
  const start = rtl ? "right" : "left";
  const end = rtl ? "left" : "right";
  const showPaymentNote = data.awaitingPayment && data.status === "PENDING";
  const greeting = data.customerName
    ? fill(copy.greeting, { name: data.customerName })
    : copy.greetingAnonymous;
  const subject =
    `${data.storeName}: ${fill(statusCopy.subject, { number: String(data.orderNumber) })}`.replace(
      /[\r\n]+/g,
      " ",
    );
  const deliveryLine = [
    data.shippingMethod && copy.methods[data.shippingMethod],
    data.deliveryDays && fill(copy.estimate, { days: data.deliveryDays }),
  ]
    .filter(Boolean)
    .join(" · ");

  const totals: { label: string; value: string; strong?: boolean }[] = [
    { label: copy.subtotal, value: data.subtotal },
    ...(data.discount ? [{ label: copy.discount, value: `−${data.discount}` }] : []),
    { label: copy.shipping, value: data.shipping },
    ...(data.tax ? [{ label: copy.tax, value: data.tax }] : []),
    { label: copy.total, value: data.total, strong: true },
  ];

  const e = escapeHtml;
  const meta = (label: string, value: string) => `
    <td class="stack" valign="top" style="padding:0 0 12px;font-family:${SANS};text-align:${start};">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.muted};padding-bottom:3px;">${e(label)}</div>
      <div style="font-size:14px;color:${COLORS.text};font-weight:600;" dir="auto">${e(value)}</div>
    </td>`;

  const itemRows = data.items
    .map(
      (item) => `
      <tr>
        <td valign="top" style="padding:14px 0;border-bottom:1px solid ${COLORS.border};font-family:${SANS};text-align:${start};">
          <div style="font-size:14px;line-height:1.4;color:${COLORS.text};font-weight:600;" dir="auto">${e(item.name)}</div>
          <div style="font-size:12px;line-height:1.5;color:${COLORS.muted};padding-top:3px;">${e(copy.sku)}: <span dir="ltr">${e(item.sku)}</span></div>
          <div style="font-size:12px;line-height:1.5;color:${COLORS.muted};">${e(copy.quantity)}: ${e(item.quantity)} × ${e(item.unitPrice)}</div>
        </td>
        <td valign="top" style="padding:14px 0;padding-${start}:16px;border-bottom:1px solid ${COLORS.border};font-family:${SANS};font-size:14px;color:${COLORS.text};text-align:${end};white-space:nowrap;">${e(item.total)}</td>
      </tr>`,
    )
    .join("");

  const totalRows = totals
    .map(
      ({ label, value, strong }) => `
      <tr>
        <td style="padding:${strong ? "12px 0 0" : "4px 0"};font-family:${SANS};font-size:${strong ? 15 : 13}px;${strong ? `font-weight:700;color:${COLORS.text};` : `color:${COLORS.muted};`}text-align:${start};">${e(label)}</td>
        <td style="padding:${strong ? "12px 0 0" : "4px 0"};font-family:${SANS};font-size:${strong ? 15 : 13}px;${strong ? `font-weight:700;` : ""}color:${COLORS.text};text-align:${end};white-space:nowrap;">${e(value)}</td>
      </tr>`,
    )
    .join("");

  const contactParts = [
    data.contactEmail &&
      `<a href="mailto:${e(data.contactEmail)}" style="color:${COLORS.text};text-decoration:underline;">${e(data.contactEmail)}</a>`,
    data.contactPhone && `<span dir="ltr">${e(data.contactPhone)}</span>`,
  ].filter(Boolean);

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
    .stack { display: block !important; width: 100% !important; }
    .heading { font-size: 24px !important; }
    .button { display: block !important; text-align: center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${COLORS.page};font-size:1px;line-height:1px;">${e(statusCopy.body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.page};">
<tr><td class="outer" align="center" style="padding:32px 12px;">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${COLORS.card};border:1px solid ${COLORS.border};">
    <tr><td class="pad" align="center" bgcolor="${COLORS.brand}" style="background-color:${COLORS.brand};padding:26px 36px;font-family:${SERIF};font-size:18px;font-weight:400;letter-spacing:${rtl ? "0" : ".32em"};${rtl ? "" : "text-transform:uppercase;"}color:${COLORS.brandText};">${e(data.storeName)}</td></tr>

    <tr><td class="pad" style="padding:36px 36px 8px;text-align:${start};">
      <div style="padding-bottom:18px;"><span style="display:inline-block;padding:5px 12px;background-color:${COLORS.soft};color:${COLORS.text};font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:${rtl ? "0" : ".08em"};${rtl ? "" : "text-transform:uppercase;"}">${e(statusCopy.label)}</span></div>
      <h1 class="heading" style="margin:0 0 16px;font-family:${SERIF};font-size:28px;line-height:1.25;font-weight:400;color:${COLORS.text};">${e(statusCopy.heading)}</h1>
      <p style="margin:0 0 8px;font-family:${SANS};font-size:15px;line-height:1.6;color:${COLORS.text};" dir="auto">${e(greeting)}</p>
      <p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.6;color:${COLORS.muted};">${e(statusCopy.body)}</p>
      ${
        showPaymentNote
          ? `<p style="margin:16px 0 0;padding:12px 14px;background-color:${COLORS.subtle};font-family:${SANS};font-size:14px;line-height:1.5;color:${COLORS.text};">${e(copy.awaitingPayment)}</p>`
          : ""
      }
      ${
        data.orderUrl
          ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td bgcolor="${COLORS.brand}" style="background-color:${COLORS.brand};"><a class="button" href="${e(data.orderUrl)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:${rtl ? "0" : ".1em"};${rtl ? "" : "text-transform:uppercase;"}color:${COLORS.brandText};text-decoration:none;">${e(copy.viewOrder)}</a></td></tr></table>`
          : ""
      }
    </td></tr>

    <tr><td class="pad" style="padding:28px 36px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${COLORS.border};"><tr><td height="20" style="font-size:0;line-height:0;">&nbsp;</td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${meta(copy.orderNumber, number)}
        ${meta(copy.orderDate, data.placedAt)}
        ${meta(copy.status, statusCopy.label)}
      </tr></table>
    </td></tr>

    <tr><td class="pad" style="padding:16px 36px 0;">
      <h2 style="margin:0 0 4px;font-family:${SERIF};font-size:18px;font-weight:400;color:${COLORS.text};text-align:${start};">${e(copy.summary)}</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemRows}</table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">${totalRows}</table>
    </td></tr>

    ${
      data.addressLines.length > 0 || deliveryLine
        ? `<tr><td class="pad" style="padding:28px 36px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.subtle}" style="background-color:${COLORS.subtle};"><tr>
        ${
          data.addressLines.length > 0
            ? `<td class="stack" valign="top" style="padding:16px 18px;font-family:${SANS};text-align:${start};">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.muted};padding-bottom:6px;">${e(copy.deliverTo)}</div>
          <div style="font-size:14px;line-height:1.55;color:${COLORS.text};" dir="auto">${data.addressLines.map(e).join("<br>")}</div>
        </td>`
            : ""
        }
        ${
          deliveryLine
            ? `<td class="stack" valign="top" style="padding:16px 18px;font-family:${SANS};text-align:${start};">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.muted};padding-bottom:6px;">${e(copy.deliveryMethod)}</div>
          <div style="font-size:14px;line-height:1.55;color:${COLORS.text};">${e(deliveryLine)}</div>
        </td>`
            : ""
        }
      </tr></table>
    </td></tr>`
        : ""
    }

    <tr><td class="pad" style="padding:32px 36px 36px;font-family:${SANS};font-size:12px;line-height:1.6;color:${COLORS.muted};text-align:${start};">
      ${contactParts.length > 0 ? `<div style="padding-bottom:8px;">${e(copy.help)} ${contactParts.join(" · ")}</div>` : ""}
      <div>${e(fill(copy.noReply, { store: data.storeName }))}</div>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    data.storeName,
    "",
    statusCopy.heading,
    "",
    greeting,
    statusCopy.body,
    ...(showPaymentNote ? ["", copy.awaitingPayment] : []),
    "",
    `${copy.orderNumber}: ${number}`,
    `${copy.orderDate}: ${data.placedAt}`,
    `${copy.status}: ${statusCopy.label}`,
    "",
    copy.summary,
    ...data.items.map(
      (item) =>
        `- ${item.name} (${item.sku}) · ${item.quantity} × ${item.unitPrice} = ${item.total}`,
    ),
    "",
    ...totals.map(({ label, value }) => `${label}: ${value}`),
    ...(data.addressLines.length > 0 ? ["", copy.deliverTo, ...data.addressLines] : []),
    ...(deliveryLine ? ["", `${copy.deliveryMethod}: ${deliveryLine}`] : []),
    ...(data.orderUrl ? ["", `${copy.viewOrder}: ${data.orderUrl}`] : []),
    ...(data.contactEmail || data.contactPhone
      ? ["", copy.help, ...[data.contactEmail, data.contactPhone].filter(Boolean)]
      : []),
    "",
    fill(copy.noReply, { store: data.storeName }),
  ].join("\n");

  return { subject, html, text };
}
