import { ChevronRight, Eye, SearchX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { CustomerStatusToggle } from "@/components/customers/customer-status-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCustomers, parseCustomerParams, type CustomerRow } from "@/lib/customers/queries";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.customers, robots: { index: false, follow: false } };
}

// Session + search params are read behind <Suspense> (Cache Components);
// requireAdmin() guards the content.
export default async function CustomersPage({
  searchParams,
}: PageProps<"/[lang]/admin/customers">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/customers">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseCustomerParams(await searchParams);
  const result = await listCustomers(params);

  const listParams = { q: params.q, status: params.status };
  // Past the last page (e.g. after filtering): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`/${locale}/admin/customers${query.size ? `?${query}` : ""}`);
  }

  const t = messages.customers;
  const common = messages.catalogue.common;
  const filtered = Boolean(params.q || params.status);
  const href = (customer: CustomerRow) => `/${locale}/admin/customers/${customer.id}`;
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "medium" }, timeZone);
  const name = (customer: CustomerRow) => customer.full_name || customer.email || t.unnamed;
  const orders = (customer: CustomerRow) => format(t.orderCount, { count: customer.order_count });
  const status = (active: boolean) => (
    <StatusBadge active={active} activeLabel={common.active} inactiveLabel={common.inactive} />
  );
  const ltr = (value: string | null) => (value ? <bdi dir="ltr">{value}</bdi> : "—");

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
              { value: "", label: common.statusAll },
              { value: "active", label: common.active },
              { value: "inactive", label: common.inactive },
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
            <EmptyState icon={Users} title={t.emptyTitle} description={t.emptyBody} />
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
                    {t.columns.customer}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                    {t.columns.phone}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {t.columns.orders}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium xl:table-cell">
                    {t.columns.lastOrder}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.joined}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.status}
                  </th>
                  <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
                    <span className="sr-only">{common.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((customer) => (
                  <tr key={customer.id} className="transition-colors hover:bg-accent/60">
                    <td className="max-w-72 px-4 py-2">
                      <Link href={href(customer)} className="group flex items-center gap-3">
                        <Avatar name={customer.full_name} email={customer.email} />
                        <span className="min-w-0">
                          <span className="line-clamp-1 font-medium group-hover:underline">
                            <bdi>{name(customer)}</bdi>
                          </span>
                          {customer.email && (
                            <span className="line-clamp-1 text-xs text-muted-foreground" dir="ltr">
                              {customer.email}
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-2 whitespace-nowrap text-muted-foreground lg:table-cell">
                      {ltr(customer.phone)}
                    </td>
                    <td className="px-4 py-2 text-end font-medium tabular-nums">
                      {customer.order_count.toLocaleString(locale)}
                    </td>
                    <td className="hidden px-4 py-2 whitespace-nowrap text-muted-foreground xl:table-cell">
                      {customer.last_order_at ? date(customer.last_order_at) : "—"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                      {date(customer.created_at)}
                    </td>
                    <td className="px-4 py-2">{status(customer.is_active)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          href={href(customer)}
                          aria-label={`${common.view}: ${name(customer)}`}
                          title={common.view}
                          className={buttonClassName({ variant: "outline", size: "icon-sm" })}
                        >
                          <Eye aria-hidden />
                        </Link>
                        <CustomerStatusToggle
                          compact
                          id={customer.id}
                          name={name(customer)}
                          active={customer.is_active}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={href(customer)}
                  className="flex items-center gap-3 px-3 py-3 active:bg-muted/40"
                >
                  <Avatar name={customer.full_name} email={customer.email} className="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm font-medium">
                      <bdi>{name(customer)}</bdi>
                    </span>
                    {customer.email && (
                      <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                        {customer.email}
                      </span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {status(customer.is_active)}
                      <span>{orders(customer)}</span>
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
        basePath={`/${locale}/admin/customers`}
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
