import { ArrowLeft, History, Package, PackageX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { Pagination } from "@/components/catalogue/pagination";
import { Panel } from "@/components/catalogue/panel";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { InitializeButton } from "@/components/inventory/initialize-button";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { ThresholdForm } from "@/components/inventory/threshold-form";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { getInventoryItem, listAdjustments, type AdjustmentRow } from "@/lib/inventory/queries";
import { formatDateTime } from "@/lib/format";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.inventory.history.title };
}

export default async function InventoryItemPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/inventory/[productId]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <InventoryItem params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** One product's stock: numbers, threshold, Adjust, and paginated history. */
async function InventoryItem({
  params,
  searchParams,
}: Pick<PageProps<"/[lang]/admin/inventory/[productId]">, "params" | "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { productId } = await params;
  if (!isUuid(productId)) notFound();
  const pageParam = Number.parseInt(String((await searchParams).page ?? ""), 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const [item, history] = await Promise.all([
    getInventoryItem(productId),
    listAdjustments(productId, page),
  ]);
  if (!item) notFound();

  const t = messages.inventory;
  const h = t.history;
  const basePath = `/${locale}/admin/inventory/${productId}`;
  const configured = item.inventory_id !== null;
  const dateTime = (value: string) => formatDateTime(value, locale);
  const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
  const admin = (row: AdjustmentRow) => row.admin?.full_name ?? h.unknownAdmin;

  const stat = (label: string, value: number | null, className?: string) => (
    <div className="min-w-0 px-4 py-3">
      <dt className="caps text-[0.625rem] text-muted-foreground">{label}</dt>
      <dd className={cn("text-2xl leading-tight font-semibold tabular-nums", className)}>
        {value === null ? "—" : value.toLocaleString(locale)}
      </dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link
          href={`/${locale}/admin/inventory`}
          aria-label={h.backToList}
          title={h.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <CatalogueImage src={item.image_url} alt="" sizes="48px" className="size-12" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              <bdi>{item.name}</bdi>
            </h1>
            <StockStatusBadge status={item.stock_status} label={t.status[item.stock_status]} />
            {!item.product_active && <Badge>{t.productInactive}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-mono" dir="ltr">
              {item.sku}
            </span>
            {item.category_name && (
              <>
                {" · "}
                <bdi>{item.category_name}</bdi>
              </>
            )}
          </p>
        </div>
        <Link
          href={`/${locale}/admin/products/${item.product_id}`}
          className={buttonClassName({ variant: "outline" })}
        >
          <Package aria-hidden />
          {messages.catalogue.common.edit}
        </Link>
        {configured && (
          <AdjustStockDialog
            item={{
              productId: item.product_id,
              name: item.name,
              sku: item.sku,
              quantity: item.quantity ?? 0,
              reserved: item.reserved_quantity ?? 0,
              threshold: item.low_stock_threshold ?? 0,
            }}
          />
        )}
      </div>

      {!configured ? (
        <Panel>
          <EmptyState
            icon={PackageX}
            title={t.notConfigured}
            action={<InitializeButton productId={item.product_id} label={t.initialize} size="md" />}
          />
        </Panel>
      ) : (
        <div className="grid gap-3">
          {/* Numbers + low-stock threshold in one strip */}
          <section className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
            <dl className="grid grid-cols-3 divide-x divide-border">
              {stat(t.columns.stock, item.quantity)}
              {stat(t.columns.reserved, item.reserved_quantity, "text-muted-foreground")}
              {stat(t.columns.available, item.available_quantity, "text-primary")}
            </dl>
            <div className="border-t px-4 py-3 md:border-t-0 md:border-s">
              <ThresholdForm
                compact
                productId={item.product_id}
                threshold={item.low_stock_threshold ?? 0}
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border bg-card">
            <h2 className="flex items-center gap-2 px-4 py-3 text-sm font-semibold">
              <History aria-hidden className="size-4 text-muted-foreground" />
              {h.title}
              {history.total > 0 && (
                <Badge className="py-0 tabular-nums">{history.total.toLocaleString(locale)}</Badge>
              )}
            </h2>
            {history.total === 0 ? (
              <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
                {h.empty}
              </p>
            ) : (
              <>
                {/* Tablet / desktop */}
                <div className="hidden md:block">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{h.title}</caption>
                    <thead className="caps border-y text-[0.625rem] text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-start font-medium">
                          {h.columns.date}
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
                        <th scope="col" className="px-4 py-3 text-start font-medium">
                          {h.columns.admin}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {history.rows.map((row) => (
                        <tr key={row.id} className="align-top transition-colors hover:bg-accent/60">
                          <td className="px-4 py-2 whitespace-nowrap">
                            {dateTime(row.created_at)}
                            <span className="block text-xs text-muted-foreground">
                              {t.adjust.types[row.adjustment_type]}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-end text-muted-foreground tabular-nums">
                            {row.quantity_before}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-end font-semibold tabular-nums",
                              row.adjustment_quantity > 0 ? "text-success" : "text-error",
                            )}
                            dir="ltr"
                          >
                            {signed(row.adjustment_quantity)}
                          </td>
                          <td className="px-3 py-2 text-end font-medium tabular-nums">
                            {row.quantity_after}
                          </td>
                          <td className="px-4 py-2">
                            {t.adjust.reasons[row.reason]}
                            {row.notes && (
                              <span
                                className="block max-w-md text-xs break-words text-muted-foreground"
                                dir="auto"
                              >
                                {row.notes}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <bdi>{admin(row)}</bdi>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Phones */}
                <ul className="divide-y border-t md:hidden">
                  {history.rows.map((row) => (
                    <li key={row.id} className="grid gap-0.5 px-4 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{t.adjust.reasons[row.reason]}</span>
                        <span className="tabular-nums" dir="ltr">
                          <span className="text-muted-foreground">
                            {row.quantity_before} → {row.quantity_after}
                          </span>{" "}
                          <span
                            className={cn(
                              "font-semibold",
                              row.adjustment_quantity > 0 ? "text-success" : "text-error",
                            )}
                          >
                            {signed(row.adjustment_quantity)}
                          </span>
                        </span>
                      </div>
                      {row.notes && (
                        <p className="text-xs break-words text-muted-foreground" dir="auto">
                          {row.notes}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {dateTime(row.created_at)} · <bdi>{admin(row)}</bdi>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          {history.pageCount > 1 && (
            <Pagination
              basePath={basePath}
              params={{}}
              page={history.page}
              pageCount={history.pageCount}
              pageSize={history.pageSize}
              total={history.total}
              labels={messages.catalogue.common}
            />
          )}
        </div>
      )}
    </div>
  );
}
