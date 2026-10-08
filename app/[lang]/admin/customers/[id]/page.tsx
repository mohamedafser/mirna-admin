import { ArrowLeft, ChevronRight, Info, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Pagination } from "@/components/catalogue/pagination";
import { Panel } from "@/components/catalogue/panel";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { CustomerStatusToggle } from "@/components/customers/customer-status-toggle";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Avatar } from "@/components/ui/avatar";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import {
  getCustomer,
  listCustomerOrders,
  parseOrdersPage,
  type CustomerOrderRow,
} from "@/lib/customers/queries";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.customers.detail.title, robots: { index: false, follow: false } };
}

export default async function CustomerPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/customers/[id]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <CustomerDetailView params={params} searchParams={searchParams} />
    </Suspense>
  );
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
 * One customer: profile (read-only apart from status), account status with
 * activate/deactivate, and their orders (paginated, stored amounts only).
 */
async function CustomerDetailView({
  params,
  searchParams,
}: Pick<PageProps<"/[lang]/admin/customers/[id]">, "params" | "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const page = parseOrdersPage(await searchParams);

  const [customer, orders] = await Promise.all([getCustomer(id), listCustomerOrders(id, page)]);
  if (!customer) notFound();
  const basePath = `/${locale}/admin/customers/${id}`;
  if (orders.rows.length === 0 && orders.total > 0) {
    redirect(orders.pageCount > 1 ? `${basePath}?page=${orders.pageCount}` : basePath);
  }

  const t = messages.customers;
  const d = t.detail;
  const o = messages.orders;
  const common = messages.catalogue.common;
  const date = (value: string) => formatDateTime(value, locale, undefined, timeZone);
  const name = customer.full_name || customer.email || t.unnamed;
  const ltr = (value: string | null) =>
    value ? (
      <span dir="ltr" className="inline-block">
        {value}
      </span>
    ) : null;
  const orderHref = (order: CustomerOrderRow) => `/${locale}/admin/orders/${order.id}`;
  const orderNumber = (order: CustomerOrderRow) => `#${order.order_number}`;
  const total = (order: CustomerOrderRow) => (
    <span className="whitespace-nowrap tabular-nums">
      {formatCurrency(order.total, order.currency_code, locale)}
    </span>
  );
  const items = (order: CustomerOrderRow) =>
    format(o.itemCount, { count: order.items[0]?.count ?? 0 });
  const orderStatus = (order: CustomerOrderRow) => (
    <OrderStatusBadge status={order.status} label={o.status[order.status]} />
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/${locale}/admin/customers`}
          aria-label={d.backToList}
          title={d.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <Avatar name={customer.full_name} email={customer.email} className="size-12 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              <bdi>{name}</bdi>
            </h1>
            <StatusBadge
              active={customer.is_active}
              activeLabel={common.active}
              inactiveLabel={common.inactive}
            />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {format(d.joinedOn, { date: date(customer.created_at) })}
          </p>
        </div>
        <CustomerStatusToggle id={customer.id} name={name} active={customer.is_active} />
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="grid gap-3">
          <Panel title={d.profile}>
            <Details
              empty={d.notProvided}
              rows={[
                [d.name, customer.full_name ? <bdi>{customer.full_name}</bdi> : null],
                [d.email, ltr(customer.email)],
                [d.phone, ltr(customer.phone)],
              ]}
            />
          </Panel>
          <Panel title={d.account}>
            <Details
              empty={d.never}
              rows={[
                [d.joined, date(customer.created_at)],
                [d.lastSignIn, customer.last_sign_in_at ? date(customer.last_sign_in_at) : null],
                [d.orders, customer.order_count.toLocaleString(locale)],
                [d.lastOrder, customer.last_order_at ? date(customer.last_order_at) : null],
              ]}
            />
            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {customer.is_active ? d.activeNote : d.inactiveNote}
            </p>
          </Panel>
        </div>

        <section className="overflow-hidden rounded-2xl border bg-card">
          <h2 className="caps px-4 py-3 text-xs font-medium sm:px-5">
            {d.orderHistory}
            {orders.total > 0 && (
              <span className="ms-1.5 text-muted-foreground tabular-nums">({orders.total})</span>
            )}
          </h2>
          {orders.total === 0 ? (
            <div className="border-t">
              <EmptyState
                icon={ShoppingCart}
                title={d.noOrdersTitle}
                description={d.noOrdersBody}
              />
            </div>
          ) : (
            <>
              {/* Tablet / desktop: table */}
              <table className="hidden w-full border-t text-sm md:table">
                <caption className="sr-only">{d.orderHistory}</caption>
                <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start font-medium sm:px-5">
                      {o.columns.number}
                    </th>
                    <th scope="col" className="px-4 py-3 text-start font-medium">
                      {o.columns.date}
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-start font-medium lg:table-cell"
                    >
                      {o.columns.items}
                    </th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">
                      {o.columns.total}
                    </th>
                    <th scope="col" className="px-4 py-3 text-start font-medium sm:pe-5">
                      {o.columns.status}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orders.rows.map((order) => (
                    <tr key={order.id} className="transition-colors hover:bg-accent/60">
                      <td className="px-4 py-2.5 sm:px-5">
                        <Link
                          href={orderHref(order)}
                          aria-label={`${o.view} ${orderNumber(order)}`}
                          className="font-medium tabular-nums hover:underline"
                        >
                          {orderNumber(order)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {date(order.created_at)}
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">
                        {items(order)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-medium">{total(order)}</td>
                      <td className="px-4 py-2.5 sm:pe-5">{orderStatus(order)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Phones: compact rows */}
              <ul className="divide-y border-t md:hidden">
                {orders.rows.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={orderHref(order)}
                      aria-label={`${o.view} ${orderNumber(order)}`}
                      className="flex items-center gap-3 px-4 py-3 active:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium tabular-nums">{orderNumber(order)}</span>
                          <span className="text-sm font-medium">{total(order)}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {orderStatus(order)}
                          <span>{date(order.created_at)}</span>
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {orders.total > 0 && (
        <Pagination
          basePath={basePath}
          params={{}}
          page={orders.page}
          pageCount={orders.pageCount}
          pageSize={orders.pageSize}
          total={orders.total}
          labels={common}
        />
      )}
    </div>
  );
}
