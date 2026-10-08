import { ChevronRight, SearchX, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";
import { listOrders, parseOrderParams, type OrderListRow } from "@/lib/orders/queries";
import { ORDER_PERIODS, ORDER_STATUSES } from "@/lib/orders/rules";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.orders };
}

// Session + search params are read behind <Suspense> (Cache Components);
// requireAdmin() guards the content.
export default async function OrdersPage({ searchParams }: PageProps<"/[lang]/admin/orders">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({ searchParams }: Pick<PageProps<"/[lang]/admin/orders">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseOrderParams(await searchParams);
  const result = await listOrders(params, timeZone);

  const listParams = { q: params.q, status: params.status, period: params.period };
  // Past the last page (e.g. after filtering): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`/${locale}/admin/orders${query.size ? `?${query}` : ""}`);
  }

  const t = messages.orders;
  const common = messages.catalogue.common;
  const filtered = Boolean(params.q || params.status || params.period);
  const href = (order: OrderListRow) => `/${locale}/admin/orders/${order.id}`;
  const number = (order: OrderListRow) => `#${order.order_number}`;
  const date = (value: string) => formatDateTime(value, locale, undefined, timeZone);
  const total = (order: OrderListRow) => (
    <span className="whitespace-nowrap tabular-nums">
      {formatCurrency(order.total, order.currency_code, locale)}
    </span>
  );
  const customer = (order: OrderListRow) => order.customer_name || order.recipient || "—";
  const items = (order: OrderListRow) => format(t.itemCount, { count: order.items[0]?.count ?? 0 });
  const status = (order: OrderListRow) => (
    <OrderStatusBadge status={order.status} label={t.status[order.status]} />
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          {t.title}
          {result.total > 0 && <Badge className="tabular-nums">{result.total}</Badge>}
        </h1>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t.subtitle}</p>
      </div>

      <ListToolbar
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        filters={[
          {
            name: "status",
            label: common.status,
            options: [
              { value: "", label: t.allStatuses },
              ...ORDER_STATUSES.map((s) => ({ value: s, label: t.status[s] })),
            ],
          },
          {
            name: "period",
            label: t.periodFilter,
            options: [
              { value: "", label: t.allTime },
              ...(Object.keys(ORDER_PERIODS) as (keyof typeof ORDER_PERIODS)[]).map((p) => ({
                value: p,
                label: t.periods[p],
              })),
            ],
          },
        ]}
      />

      {result.total === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={SearchX}
              title={common.noResultsTitle}
              description={common.noResultsBody}
            />
          ) : (
            <EmptyState icon={ShoppingCart} title={t.emptyTitle} description={t.emptyBody} />
          )}
        </Card>
      ) : (
        <>
          {/* Tablet / desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t.title}</caption>
              <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.number}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.date}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.customer}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                    {t.columns.items}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {t.columns.total}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.status}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium xl:table-cell">
                    {t.columns.payment}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-accent/60">
                    <td className="px-4 py-2.5">
                      <Link
                        href={href(order)}
                        aria-label={`${t.view} ${number(order)}`}
                        className="font-medium tabular-nums hover:underline"
                      >
                        {number(order)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {date(order.created_at)}
                    </td>
                    <td className="max-w-64 px-4 py-2.5">
                      <span className="line-clamp-1">
                        <bdi>{customer(order)}</bdi>
                      </span>
                      {order.customer_email && (
                        <span className="line-clamp-1 text-xs text-muted-foreground" dir="ltr">
                          {order.customer_email}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">
                      {items(order)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-medium">{total(order)}</td>
                    <td className="px-4 py-2.5">{status(order)}</td>
                    <td className="hidden px-4 py-2.5 xl:table-cell">
                      <Badge>{t.payment.notPaidOnline}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((order) => (
              <li key={order.id}>
                <Link
                  href={href(order)}
                  aria-label={`${t.view} ${number(order)}`}
                  className="flex items-center gap-3 px-3 py-3 active:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium tabular-nums">{number(order)}</span>
                      <span className="text-sm font-medium">{total(order)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm">
                      <bdi>{customer(order)}</bdi>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {status(order)}
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

      <Pagination
        basePath={`/${locale}/admin/orders`}
        params={listParams}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        total={result.total}
        labels={common}
      />
    </div>
  );
}
