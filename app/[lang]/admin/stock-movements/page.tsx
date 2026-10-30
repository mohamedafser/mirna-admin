import { History, PackagePlus, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import {
  listMovements,
  MOVEMENT_PERIODS,
  MOVEMENT_REASONS,
  parseMovementParams,
  type MovementRow,
} from "@/lib/inventory/queries";
import { ADJUSTMENT_TYPES } from "@/lib/inventory/rules";
import { getStoreRegion } from "@/lib/settings/queries";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.stockMovements };
}

// Session + search params are read behind <Suspense> (Cache Components);
// requireAdmin() guards the content.
export default async function StockMovementsPage({
  searchParams,
}: PageProps<"/[lang]/admin/stock-movements">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Movements searchParams={searchParams} />
    </Suspense>
  );
}

/** Every stock change across the catalogue, newest first, with filters. */
async function Movements({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/stock-movements">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseMovementParams(await searchParams);
  const result = await listMovements(params);

  const listParams = {
    q: params.q,
    type: params.type,
    reason: params.reason,
    period: params.period,
  };
  const basePath = `/${locale}/admin/stock-movements`;
  // Past the last page (e.g. after a filter change): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`${basePath}${query.size ? `?${query}` : ""}`);
  }

  const t = messages.inventory;
  const h = t.history;
  const m = t.movements;
  const filtered = Boolean(params.q || params.type || params.reason || params.period);
  const dateTime = (value: string) => formatDateTime(value, locale, undefined, timeZone);
  const number = (value: number) => value.toLocaleString(locale);
  const signed = (value: number) => `${value > 0 ? "+" : "−"}${number(Math.abs(value))}`;
  // Sales and cancellations (migration 043) link to their order instead.
  const admin = (row: MovementRow) =>
    row.order_id && row.order ? (
      <Link href={`/${locale}/admin/orders/${row.order_id}`} className="hover:underline">
        {format(h.order, { number: row.order.order_number })}
      </Link>
    ) : (
      (row.admin?.full_name ?? h.unknownAdmin)
    );
  const historyHref = (row: MovementRow) =>
    `/${locale}/admin/inventory/${row.product_id}${row.variant_id ? `?variant=${row.variant_id}` : ""}`;
  const variantSku = (row: MovementRow) => row.variant?.sku ?? row.variant_sku;

  const item = (row: MovementRow) => (
    <span className="grid min-w-0 gap-0.5">
      <Link href={historyHref(row)} className="line-clamp-1 font-medium hover:underline">
        <bdi>{row.product?.name ?? h.productLevel}</bdi>
      </Link>
      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
        {variantSku(row) ?? row.product?.sku}
      </span>
    </span>
  );
  const change = (row: MovementRow) => (
    <span
      className={cn(
        "font-semibold tabular-nums",
        row.adjustment_quantity > 0 ? "text-success" : "text-error",
      )}
      dir="ltr"
    >
      {signed(row.adjustment_quantity)}
    </span>
  );
  const reason = (row: MovementRow) => (
    <>
      {t.adjust.reasons[row.reason]}
      {row.notes && (
        <span className="block max-w-md text-xs break-words text-muted-foreground" dir="auto">
          {row.notes}
        </span>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.stockMovements}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{m.subtitle}</p>
        </div>
        <Link href={`/${locale}/admin/stock-update`} className={buttonClassName()}>
          <PackagePlus aria-hidden />
          {messages.nav.stockUpdate}
        </Link>
      </div>

      <ListToolbar
        searchLabel={m.searchLabel}
        searchPlaceholder={m.searchPlaceholder}
        filters={[
          {
            name: "type",
            label: t.adjust.type,
            options: [
              { value: "", label: m.allTypes },
              ...ADJUSTMENT_TYPES.map((value) => ({ value, label: t.adjust.types[value] })),
            ],
          },
          {
            name: "reason",
            label: t.adjust.reason,
            options: [
              { value: "", label: m.allReasons },
              ...MOVEMENT_REASONS.map((value) => ({ value, label: t.adjust.reasons[value] })),
            ],
          },
          {
            name: "period",
            label: m.period,
            options: [
              { value: "", label: m.allTime },
              ...Object.keys(MOVEMENT_PERIODS).map((value) => ({
                value,
                label: format(m.lastDays, { count: value }),
              })),
            ],
          },
        ]}
      />

      {result.total === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState icon={SearchX} title={m.noMatchTitle} description={m.noMatchBody} />
          ) : (
            <EmptyState icon={History} title={m.emptyTitle} description={m.emptyBody} />
          )}
        </Card>
      ) : (
        <>
          {/* Tablet / desktop */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{messages.nav.stockMovements}</caption>
              <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {h.columns.date}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {m.item}
                  </th>
                  <th scope="col" className="px-3 py-3 text-end font-medium">
                    {h.columns.before}
                  </th>
                  <th scope="col" className="px-3 py-3 text-end font-medium">
                    {h.columns.change}
                  </th>
                  <th scope="col" className="px-3 py-3 text-end font-medium">
                    {h.columns.after}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {h.columns.reason}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                    {h.columns.admin}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((row) => (
                  <tr key={row.id} className="align-top transition-colors hover:bg-accent/60">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {dateTime(row.created_at)}
                      <span className="block text-xs text-muted-foreground">
                        {t.adjust.types[row.adjustment_type]}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-2">{item(row)}</td>
                    <td className="px-3 py-2 text-end text-muted-foreground tabular-nums">
                      {number(row.quantity_before)}
                    </td>
                    <td className="px-3 py-2 text-end">{change(row)}</td>
                    <td className="px-3 py-2 text-end font-medium tabular-nums">
                      {number(row.quantity_after)}
                    </td>
                    <td className="px-4 py-2">{reason(row)}</td>
                    <td className="hidden px-4 py-2 text-muted-foreground lg:table-cell">
                      <bdi>{admin(row)}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((row) => (
              <li key={row.id} className="grid gap-1.5 px-3 py-2.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  {item(row)}
                  {change(row)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {dateTime(row.created_at)} · {t.adjust.types[row.adjustment_type]} ·{" "}
                  <span className="tabular-nums" dir="ltr">
                    {number(row.quantity_before)} → {number(row.quantity_after)}
                  </span>
                </div>
                <div className="text-xs">{reason(row)}</div>
                <div className="text-xs text-muted-foreground">
                  <bdi>{admin(row)}</bdi>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination
        basePath={basePath}
        params={listParams}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        total={result.total}
        labels={messages.catalogue.common}
      />
    </div>
  );
}
