import { ArrowLeft, CreditCard, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Panel } from "@/components/catalogue/panel";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { StatusActions } from "@/components/orders/status-actions";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import type { Locale } from "@/config/i18n";
import { requireAdmin } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";
import { getOrder, type AddressSnapshot } from "@/lib/orders/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.orders, robots: { index: false, follow: false } };
}

export default async function OrderPage({ params }: PageProps<"/[lang]/admin/orders/[id]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <OrderDetailView params={params} />
    </Suspense>
  );
}

function countryName(code: string | undefined, locale: Locale): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Label/value rows; empty values show "Not provided". */
function Details({ rows, empty }: { rows: [string, ReactNode][]; empty: string }) {
  return (
    <dl className="grid gap-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words">
            {value || <span className="text-muted-foreground">{empty}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One order exactly as stored: items, prices and totals from order_items /
 * orders, the customer and address from the checkout snapshot. Nothing is
 * looked up in current products.
 */
async function OrderDetailView({ params }: Pick<PageProps<"/[lang]/admin/orders/[id]">, "params">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const t = messages.orders;
  const d = t.detail;
  const money = (amount: string) => formatCurrency(amount, order.currency_code, locale);
  const date = (value: string) => formatDateTime(value, locale, undefined, timeZone);
  const address: AddressSnapshot = order.shipping_address_snapshot ?? {};
  const customer = address.customer ?? {};
  const ltr = (value: string | null | undefined) =>
    value ? (
      <span dir="ltr" className="inline-block">
        {value}
      </span>
    ) : null;

  const addressLines = [
    address.street,
    [address.building, address.apartment].filter(Boolean).join(", "),
    address.area,
    [address.city, address.state_region].filter(Boolean).join(", "),
    [countryName(address.country_code, locale), address.postal_code].filter(Boolean).join(" "),
  ].filter(Boolean);

  // Stored amounts only; the discount row appears when one was applied.
  const totals: [label: string, value: string][] = [
    [d.subtotal, money(order.subtotal)],
    ...(/[1-9]/.test(order.discount)
      ? [[d.discount, `−${money(order.discount)}`] as [string, string]]
      : []),
    [d.shipping, money(order.shipping)],
    [d.tax, money(order.tax)],
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <Link
          href={`/${locale}/admin/orders`}
          aria-label={d.backToList}
          title={d.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm", className: "mt-0.5" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {format(d.title, { number: order.order_number })}
            </h1>
            <OrderStatusBadge status={order.status} label={t.status[order.status]} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {format(d.placedOn, { date: date(order.created_at) })}
            {" · "}
            {format(d.updatedOn, { date: date(order.updated_at) })}
          </p>
        </div>
      </div>

      <p className="mb-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {d.snapshotNote}
      </p>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3">
          {/* Items: stored snapshots only */}
          <section className="overflow-hidden rounded-2xl border bg-card">
            <h2 className="caps px-4 py-3 text-xs font-medium sm:px-5">{d.items}</h2>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">{d.items}</caption>
                <thead className="caps border-y text-[0.625rem] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start font-medium sm:px-5">
                      {d.product}
                    </th>
                    <th scope="col" className="px-3 py-3 text-end font-medium">
                      {d.quantity}
                    </th>
                    <th scope="col" className="px-3 py-3 text-end font-medium">
                      {d.unitPrice}
                    </th>
                    <th scope="col" className="px-4 py-3 text-end font-medium sm:px-5">
                      {d.lineTotal}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 sm:px-5">
                        <span className="font-medium">
                          <bdi>{item.product_name}</bdi>
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground" dir="ltr">
                          {item.sku}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{item.quantity}</td>
                      <td className="px-3 py-2.5 text-end whitespace-nowrap tabular-nums">
                        {money(item.unit_price)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-medium whitespace-nowrap tabular-nums sm:px-5">
                        {money(item.total_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y border-t md:hidden">
              {order.items.map((item) => (
                <li key={item.id} className="grid gap-0.5 px-4 py-3 text-sm">
                  <span className="font-medium">
                    <bdi>{item.product_name}</bdi>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {item.sku}
                  </span>
                  <span className="flex justify-between gap-3 tabular-nums">
                    <span className="text-muted-foreground">
                      {item.quantity} × {money(item.unit_price)}
                    </span>
                    <span className="font-medium">{money(item.total_price)}</span>
                  </span>
                </li>
              ))}
            </ul>

            <dl className="grid gap-2 border-t px-4 py-3 text-sm sm:px-5">
              {totals.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                <dt>{d.total}</dt>
                <dd className="tabular-nums">{money(order.total)}</dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <Panel title={d.customer}>
              <Details
                empty={d.notProvided}
                rows={[
                  [d.name, customer.full_name ? <bdi>{customer.full_name}</bdi> : null],
                  [d.email, ltr(customer.email)],
                  [d.phone, ltr(customer.phone)],
                ]}
              />
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                {d.account}:{" "}
                {order.account === null ? (
                  d.accountDeleted
                ) : order.account.is_active ? (
                  <bdi>{order.account.full_name || d.notProvided}</bdi>
                ) : (
                  d.accountInactive
                )}
              </p>
            </Panel>

            <Panel title={d.shippingAddress}>
              <address className="grid gap-0.5 text-sm not-italic">
                <span className="font-medium">
                  <bdi>{address.full_name}</bdi>
                </span>
                {addressLines.map((line) => (
                  <span key={line} className="text-muted-foreground">
                    <bdi>{line}</bdi>
                  </span>
                ))}
                {address.phone && (
                  <span dir="ltr" className="mt-1 justify-self-start">
                    {address.phone}
                  </span>
                )}
              </address>
              {address.additional_instructions && (
                <p className="mt-3 border-t pt-3 text-sm">
                  <span className="block text-xs text-muted-foreground">{d.instructions}</span>
                  <span dir="auto">{address.additional_instructions}</span>
                </p>
              )}
            </Panel>
          </div>
        </div>

        <div className="grid gap-3 lg:sticky lg:top-20">
          <Panel title={d.statusTitle}>
            <div className="mb-4">
              <OrderStatusBadge status={order.status} label={t.status[order.status]} />
            </div>
            <StatusActions
              orderId={order.id}
              orderNumber={order.order_number}
              status={order.status}
            />
            <p className="mt-4 text-xs text-muted-foreground">{d.workflow}</p>
          </Panel>

          <Panel title={t.payment.title}>
            <Badge>
              <CreditCard aria-hidden />
              {t.payment.notPaidOnline}
            </Badge>
            <p className="mt-3 text-xs text-muted-foreground">{t.payment.note}</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
