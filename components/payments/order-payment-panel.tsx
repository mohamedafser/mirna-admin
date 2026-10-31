import { CreditCard, ExternalLink } from "lucide-react";
import { Panel } from "@/components/catalogue/panel";
import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/config/i18n";
import { formatMinor } from "@/lib/currency/money";
import { formatDateTime, toIntlLocale } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { format } from "@/lib/i18n/messages";
import type { OrderPayment, OrderPayments } from "@/lib/payments/queries";
import { isCaptured, refundableMinor } from "@/lib/payments/rules";
import type { OrderDetail } from "@/lib/orders/queries";
import { PaymentStatusBadge } from "./payment-status-badge";
import { RefreshPaymentButton } from "./refresh-payment-button";
import { cn } from "@/lib/utils/cn";
import { RefundDialog } from "./refund-dialog";

/** Stripe Dashboard link for a PaymentIntent (test-mode payments live under /test). */
function dashboardUrl(payment: OrderPayment): string {
  return `https://dashboard.stripe.com/${payment.livemode ? "" : "test/"}payments/${payment.stripe_payment_intent_id}`;
}

/**
 * The order's payment: its status, then each PaymentIntent (method, Stripe
 * references, amounts, refunds) and the webhook events received for it.
 * Everything is the stored state that Stripe's webhooks wrote; "Refresh from
 * Stripe" re-reads it on demand. Card numbers are never stored, only the
 * brand and last four digits.
 */
export function OrderPaymentPanel({
  order,
  data,
  locale,
  messages,
  timeZone,
}: {
  order: OrderDetail;
  data: OrderPayments | null;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}) {
  const t = messages.orders.payment;
  const date = (value: string) => formatDateTime(value, locale, undefined, timeZone);
  const currency = { code: order.currency_code, decimals: data?.decimals ?? 2 };
  const money = (minor: number | bigint) => formatMinor(minor, currency, toIntlLocale(locale));

  // Not paid online (placed before migration 044 or while Stripe was off).
  if (order.payment_status === null) {
    return (
      <Panel title={t.title}>
        <Badge>
          <CreditCard aria-hidden />
          {t.notPaidOnline}
        </Badge>
        <p className="mt-3 text-xs text-muted-foreground">{t.note}</p>
      </Panel>
    );
  }

  const payments = data?.payments ?? [];
  const events = data?.events ?? [];
  const awaiting =
    order.status === "PENDING" &&
    (order.payment_status === "PENDING" || order.payment_status === "FAILED");
  const overdue = order.payment_due_at !== null && new Date(order.payment_due_at) < new Date();

  // Transaction history: the stored payment and refund records (complete
  // whichever path updated them: webhook, instant confirmation, refund,
  // refresh), plus every webhook event received, newest first.
  type HistoryEntry = {
    key: string;
    at: string;
    title: string;
    detail: string | null;
    tone?: "error";
  };
  const h = t.timeline;
  const history: HistoryEntry[] = [
    ...payments.flatMap((payment): HistoryEntry[] => {
      const amount = money(payment.amount_minor);
      const id = payment.stripe_payment_intent_id;
      return [
        {
          key: `${payment.id}-created`,
          at: payment.created_at,
          title: format(h.started, { amount }),
          detail: id,
        },
        ...(payment.failed_at
          ? [
              {
                key: `${payment.id}-failed`,
                at: payment.failed_at,
                title: h.declined,
                detail: payment.failure_message ?? payment.failure_code,
                tone: "error" as const,
              },
            ]
          : []),
        ...(payment.paid_at
          ? [
              {
                key: `${payment.id}-paid`,
                at: payment.paid_at,
                title: format(h.paid, { amount }),
                detail: payment.stripe_charge_id,
              },
            ]
          : []),
        ...(payment.canceled_at
          ? [
              {
                key: `${payment.id}-canceled`,
                at: payment.canceled_at,
                title: h.cancelled,
                detail: id,
              },
            ]
          : []),
        ...payment.refunds.map((refund) => ({
          key: refund.id,
          at: refund.created_at,
          title: format(h.refund, {
            amount: money(refund.amount_minor),
            status: t.refundStatus[refund.status],
          }),
          detail: refund.stripe_refund_id,
          tone: refund.status === "FAILED" ? ("error" as const) : undefined,
        })),
      ];
    }),
    ...events.map((event) => ({
      key: event.stripe_event_id,
      at: event.stripe_created_at,
      title: format(h.webhook, {
        event: t.events[event.event_type as keyof typeof t.events] ?? event.event_type,
        outcome: event.outcome ? t.eventOutcome[event.outcome as keyof typeof t.eventOutcome] : "…",
      }),
      detail: event.stripe_event_id,
      tone: event.outcome === "failed" ? ("error" as const) : undefined,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Panel title={t.title}>
      <PaymentStatusBadge status={order.payment_status} labels={t.status} />
      {order.paid_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          {format(t.paidOn, { date: date(order.paid_at) })}
        </p>
      )}
      {awaiting && order.payment_due_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          {format(overdue ? t.overdue : t.dueBy, { date: date(order.payment_due_at) })}
        </p>
      )}
      {payments.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{t.noAttempt}</p>}

      {payments.map((payment, index) => {
        const refundable = refundableMinor(
          BigInt(payment.amount_received_minor),
          payment.refunds.map((refund) => ({
            amountMinor: BigInt(refund.amount_minor),
            status: refund.status,
          })),
        );
        const method = payment.card_last4
          ? format(t.card, {
              brand: (payment.card_brand ?? "").toUpperCase(),
              last4: payment.card_last4,
            })
          : payment.payment_method_type;
        const wallet = payment.wallet
          ? (t.wallets[payment.wallet as keyof typeof t.wallets] ?? payment.wallet)
          : null;

        return (
          <div key={payment.id} className="mt-4 border-t pt-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {payments.length > 1 &&
                  `${format(t.attempt, { number: payments.length - index })} · `}
                {date(payment.created_at)}
              </span>
              <span className="flex items-center gap-1.5">
                {!payment.livemode && <Badge tone="warning">{t.testMode}</Badge>}
                <PaymentStatusBadge status={payment.status} labels={t.status} />
              </span>
            </div>

            <dl className="mt-3 grid gap-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t.amount}</dt>
                <dd className="tabular-nums">{money(payment.amount_minor)}</dd>
              </div>
              {payment.amount_refunded_minor > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t.refunded}</dt>
                  <dd className="tabular-nums">−{money(payment.amount_refunded_minor)}</dd>
                </div>
              )}
              {method && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t.method}</dt>
                  <dd dir="ltr" className="text-end">
                    {wallet ? `${wallet} · ${method}` : method}
                  </dd>
                </div>
              )}
              <div className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{t.reference}</dt>
                <dd>
                  <a
                    href={dashboardUrl(payment)}
                    target="_blank"
                    rel="noreferrer noopener"
                    dir="ltr"
                    className="inline-flex items-center gap-1 font-mono text-xs break-all underline-offset-2 hover:underline"
                    title={t.viewInStripe}
                  >
                    {payment.stripe_payment_intent_id}
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                  </a>
                </dd>
              </div>
              {payment.stripe_charge_id && (
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">{t.charge}</dt>
                  <dd dir="ltr" className="font-mono text-xs break-all">
                    {payment.stripe_charge_id}
                  </dd>
                </div>
              )}
            </dl>

            {payment.status === "FAILED" && (payment.failure_message || payment.failure_code) && (
              <p className="mt-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
                {format(t.failure, {
                  reason: payment.failure_message ?? payment.failure_code ?? "",
                })}
              </p>
            )}

            {payment.refunds.length > 0 && (
              <div className="mt-3">
                <h3 className="caps mb-2 text-[0.625rem] font-medium text-muted-foreground">
                  {t.refunds}
                </h3>
                <ul className="grid gap-2">
                  {payment.refunds.map((refund) => (
                    <li
                      key={refund.id}
                      className="grid gap-0.5 rounded-lg border px-3 py-2 text-xs"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium tabular-nums">
                          −{money(refund.amount_minor)}
                        </span>
                        <Badge
                          tone={
                            refund.status === "SUCCEEDED"
                              ? "success"
                              : refund.status === "FAILED" || refund.status === "CANCELLED"
                                ? "error"
                                : "warning"
                          }
                        >
                          {t.refundStatus[refund.status]}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground">
                        {date(refund.created_at)}
                        {" · "}
                        {refund.requested_by_profile?.full_name
                          ? format(t.refundBy, { name: refund.requested_by_profile.full_name })
                          : t.refundFromStripe}
                      </span>
                      {refund.reason && (
                        <span className="text-muted-foreground">
                          {t.reasons[refund.reason as keyof typeof t.reasons] ?? refund.reason}
                        </span>
                      )}
                      {refund.note && <span dir="auto">{refund.note}</span>}
                      {refund.failure_reason && (
                        <span className="text-error" dir="ltr">
                          {refund.failure_reason}
                        </span>
                      )}
                      <span dir="ltr" className="font-mono text-muted-foreground">
                        {refund.stripe_refund_id}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {isCaptured(payment.status) && refundable > BigInt(0) && (
                <RefundDialog
                  paymentId={payment.id}
                  orderNumber={order.order_number}
                  currency={currency}
                  refundableMinor={refundable.toString()}
                />
              )}
              <RefreshPaymentButton paymentId={payment.id} />
            </div>
          </div>
        );
      })}

      <details className="group mt-4 border-t pt-3 text-sm">
        <summary className="caps cursor-pointer text-[0.625rem] font-medium text-muted-foreground">
          {t.history} ({history.length})
        </summary>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t.noHistory}</p>
        ) : (
          <ol className="mt-2 grid gap-2">
            {history.map((entry) => (
              <li key={entry.key} className="grid gap-0.5 text-xs">
                <span className="flex justify-between gap-2">
                  <span className={cn("font-medium", entry.tone === "error" && "text-error")}>
                    {entry.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{date(entry.at)}</span>
                </span>
                {entry.detail && (
                  <span className="text-muted-foreground">
                    <span dir="ltr" className="font-mono">
                      {entry.detail}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </details>
    </Panel>
  );
}
